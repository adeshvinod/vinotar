/**
 * Fretnoodle — Ear trainer
 *
 * Drives ear-training.html. The app plays a note or a short melody on the
 * guitar samples; the student finds it on their own guitar; the microphone
 * (assets/js/pitch-detector.js) hears each note they play.
 *
 * Like a teacher sitting next to the student, it watches where they get stuck
 * on the note they are looking for and steps in, a little at a time:
 *   a wrong note        names what they played (never which way to go)
 *   help 1 (slower)     replays the melody at a slower tempo
 *   help 2 (isolate)    plays just that note: the first note on its own (the
 *                       anchor), or a later note together with the one before
 *   help 3 (reveal)     names the note and shows where it is on the neck; the
 *                       student still has to play it
 * Each note is rated on speed, wrong tries and help (not shown; it decides
 * levels): good rounds move the student up (longer melodies), struggling
 * rounds ease back. The Feedback button turns the history into averages and
 * weak areas (section 9).
 *
 * Not hearing itself: the app stops listening while it plays, plus a short
 * tail, and its notes are cut cleanly instead of ringing on. The note tracker
 * is reset when listening resumes.
 *
 * Sections
 *   1. Constants
 *   2. State and saved progress
 *   3. Sound (guitar samples)
 *   4. Microphone and listening
 *   5. Melodies
 *   6. Rounds, judging and help
 *   7. Rendering
 *   8. Fretboard and keyboard
 *   9. Feedback
 *  10. Events and start-up
 */
(function () {
  'use strict';

  var PD = window.PitchDetector;

  /* ========================================================================
   * 1. Constants
   * ===================================================================== */

  var NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
  var KEYS = { C: 0, G: 7, D: 2, A: 9, E: 4, F: 5 };

  var RANGE_LOW = 45;    // A2: melodies stay within the first few frets' reach
  var RANGE_HIGH = 67;   // G4

  var LEVELS = [
    { length: 1, name: 'Single notes' },
    { length: 2, name: 'Two-note melodies' },
    { length: 3, name: 'Three-note melodies' },
    { length: 4, name: 'Four-note melodies' }
  ];

  var TEMPO = 84;            // bpm for the melody
  var SLOW_TEMPO = 52;       // bpm when helping
  var NOTE_LENGTH = 0.85;    // fraction of a beat each prompt note sounds
  var LISTEN_TAIL_MS = 300;  // keep not listening this long after the app's last note
  var MIC_LOW_CUT = 70;      // Hz, below the low E
  var MIC_HIGH_CUT = 1800;   // Hz, above the notes the game uses (keeps their 2nd harmonic)

  /** Reward sounds, high and bright so they read as "ding", not as a guitar note. */
  var CHIME_NOTE = [1976, 2637];          // B6, E7
  var CHIME_ROUND = [1568, 1976, 2637];   // G6, B6, E7
  var CHIME_STEP = 0.07;                  // s between chime notes
  var CHIME_RING = 0.16;                  // s each chime note rings
  var CHIME_TAIL_MS = 120;                // not listening this long after a chime

  /** When to step in on the note being searched for (whichever comes first). */
  var HELP_STEPS = [
    { seconds: 12, wrong: 4 },   // → 1: slower
    { seconds: 24, wrong: 7 },   // → 2: isolate
    { seconds: 40, wrong: 10 }   // → 3: reveal
  ];
  var HELP_WEIGHT = [1, 0.75, 0.5, 0.15];   // how much a found note counts after each help level
  var ROUNDS_TO_LEVEL_UP = 3;
  var ROUNDS_TO_EASE = 2;
  var NEXT_ROUND_DELAY_MS = 3200;

  /** Open strings, high E to low E, for "where is it" positions. */
  var OPEN_STRINGS = [{ name: 'high E', midi: 64 }, { name: 'B', midi: 59 }, { name: 'G', midi: 55 },
    { name: 'D', midi: 50 }, { name: 'A', midi: 45 }, { name: 'low E', midi: 40 }];

  var SAMPLE_FOLDER = 'guitar%20sounds/';
  var SAMPLE_NAMES = [
    'D2', 'Dsharp2', 'E2', 'F2', 'Fsharp2', 'G2', 'A2', 'Asharp2', 'B2',
    'C3', 'Csharp3', 'D3', 'Dsharp3', 'E3', 'F3', 'Fsharp3', 'G3', 'Gsharp3', 'A3', 'Asharp3', 'B3',
    'C4', 'Csharp4', 'D4', 'Dsharp4', 'E4', 'F4', 'Fsharp4', 'G4', 'Gsharp4', 'A4', 'Asharp4', 'B4',
    'C5', 'Csharp5', 'D5', 'Dsharp5', 'E5', 'F5', 'Fsharp5', 'G5', 'Gsharp5'
  ];
  var SAMPLE_FILE_SUFFIX = { A4: '-7-spn', Asharp4: '-7-spn' };   // default '-1-spn'

  /* ========================================================================
   * 2. State and saved progress
   * ===================================================================== */

  var STORAGE_KEY = 'fretnoodle.earTraining';

  var settings = { key: 'C', level: 0, exactOctave: false, view: 'fretboard' };
  var stats = { goodRounds: 0, poorRounds: 0 };   // for levelling up and easing off

  /**
   * @typedef {Object} Round
   * @property {number[]} notes      MIDI notes of the melody
   * @property {number}   index      note being searched for
   * @property {Array}    results    per found note: { midi, seconds, wrong, help, quality }
   * @property {string}   phase      'listen' (first play) | 'play' | 'done'
   * @property {number}   wrong      wrong notes on the current note
   * @property {number}   help       help level reached on the current note (0–3)
   * @property {number}   noteStart  performance.now() when the current search started
   */
  var round = null;
  var message = { text: '', tone: '' };    // tone: '' | 'good' | 'nudge'
  var lastFound = null;                      // { midi, time } to ignore an echo of the note just found
  var lastJudged = null;                     // { midi, wasWrong } for octave corrections
  var nextRoundTimer = null;

  function byId(id) { return document.getElementById(id); }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      if (KEYS[saved.key] !== undefined) settings.key = saved.key;
      if (saved.level >= 0 && saved.level < LEVELS.length) settings.level = saved.level;
      settings.exactOctave = !!saved.exactOctave;
      if (saved.view === 'keyboard') settings.view = 'keyboard';
    } catch (error) { /* storage unavailable */ }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        key: settings.key, level: settings.level, exactOctave: settings.exactOctave, view: settings.view
      }));
    } catch (error) { /* storage unavailable */ }
  }

  function noteName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
  function pitchName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12]; }

  /* ========================================================================
   * 3. Sound
   * ===================================================================== */

  var context = null;
  var samples = {};          // midi → { buffer, offset } (Web Audio) or { url } (<audio> fallback)
  var sampleMidis = [];
  var ELEMENT_ATTACK_SKIP = 0.06;   // s of leading silence skipped when a sample can't be measured
  var speakingUntil = 0;     // performance.now() until which the app is playing (plus tail)

  function getContext() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    if (context.state !== 'running') {
      var resuming = context.resume();
      if (resuming && resuming.catch) resuming.catch(function () {});
    }
    return context;
  }

  function sampleMidi(name) {
    var match = /^([A-G])(sharp)?(\d)$/.exec(name);
    var offsets = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return (Number(match[3]) + 1) * 12 + offsets[match[1]] + (match[2] ? 1 : 0);
  }

  /** Seconds of near-silence at the start of a sample (the recordings have 20–140 ms). */
  function attackOffset(buffer) {
    var data = buffer.getChannelData(0);
    var peak = 0;
    for (var i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    for (i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > peak * 0.05) return Math.max(0, i / buffer.sampleRate - 0.004);
    }
    return 0;
  }

  /**
   * Decode every sample for Web Audio. Where that isn't possible (the page
   * opened as a file://, where browsers block fetch, or a file that fails to
   * load) the note falls back to a plain <audio> element, so sound problems
   * never stop the microphone from starting.
   */
  function loadSamples() {
    var ctx = getContext();
    var canFetch = window.fetch && location.protocol !== 'file:';
    return Promise.all(SAMPLE_NAMES.map(function (name) {
      var midi = sampleMidi(name);
      var url = SAMPLE_FOLDER + name + (SAMPLE_FILE_SUFFIX[name] || '-1-spn') + '.wav';
      sampleMidis.push(midi);
      var fallback = function () {
        var audio = new Audio();
        audio.preload = 'auto';
        audio.src = url;
        samples[midi] = { url: url, element: audio };
      };
      if (!canFetch) { fallback(); return Promise.resolve(); }
      return fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error(response.status);
          return response.arrayBuffer();
        })
        .then(function (data) {
          return new Promise(function (resolve, reject) { ctx.decodeAudioData(data, resolve, reject); });
        })
        .then(function (buffer) { samples[midi] = { buffer: buffer, offset: attackOffset(buffer) }; })
        .catch(fallback);
    }));
  }

  /** Schedule one note; it is cut after `duration` so it never rings into listening time. */
  function playNote(midi, when, duration) {
    var nearest = sampleMidis[0];
    sampleMidis.forEach(function (candidate) {
      if (Math.abs(candidate - midi) < Math.abs(nearest - midi)) nearest = candidate;
    });
    var sample = samples[nearest];
    var rate = Math.pow(2, (midi - nearest) / 12);
    if (!sample.buffer) { playElementNote(sample, rate, when, duration); return; }
    var source = context.createBufferSource();
    var gain = context.createGain();
    source.buffer = sample.buffer;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(0.9, when);
    gain.gain.setTargetAtTime(0, when + duration, 0.035);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(when, sample.offset);
    source.stop(when + duration + 0.3);
  }

  /** <audio> fallback: same timing on a timer, cut with a short fade. */
  function playElementNote(sample, rate, when, duration) {
    var audio = sample.element.cloneNode();
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
    audio.playbackRate = rate;
    audio.volume = 0.9;
    var delay = Math.max(0, (when - context.currentTime) * 1000);
    setTimeout(function () {
      try { audio.currentTime = ELEMENT_ATTACK_SKIP; } catch (error) { /* not loaded yet: play from 0 */ }
      audio.play().catch(function () {});
      setTimeout(function () {
        var fade = setInterval(function () {
          audio.volume = Math.max(0, audio.volume - 0.15);
          if (audio.volume === 0) {
            clearInterval(fade);
            audio.pause();
            audio.removeAttribute('src');   // free the media player (phones allow only a few)
            audio.load();
          }
        }, 15);
      }, duration * 1000);
    }, delay);
  }

  /**
   * Play notes at a tempo. While they sound (and for a short tail) the app
   * does not listen. `slots` names the melody slot to light for each note.
   * @returns {Promise} resolves when listening may resume
   */
  function playPrompt(notes, tempo, slots) {
    var ctx = getContext();
    var beat = 60 / tempo;
    var start = ctx.currentTime + 0.08;
    var totalMs = (0.08 + notes.length * beat) * 1000;
    speakingUntil = performance.now() + totalMs + LISTEN_TAIL_MS;

    notes.forEach(function (midi, i) {
      playNote(midi, start + i * beat, beat * NOTE_LENGTH);
      setTimeout(function () { flashSlot(slots ? slots[i] : i); }, (0.08 + i * beat) * 1000);
    });
    renderLive();
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (tracker) tracker.reset(true);   // ignore anything still ringing from before
        resolve();
      }, totalMs + LISTEN_TAIL_MS);
    });
  }

  /**
   * Short sine "ding" on a correct note (two notes) or a finished melody
   * (three). Not listened to: the app pauses listening while it sounds.
   */
  function playChime(frequencies) {
    var ctx = getContext();
    var start = ctx.currentTime + 0.01;
    frequencies.forEach(function (frequency, i) {
      var when = start + i * CHIME_STEP;
      var oscillator = ctx.createOscillator();
      var gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.18, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + CHIME_RING);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(when);
      oscillator.stop(when + CHIME_RING + 0.02);
    });
    var totalMs = ((frequencies.length - 1) * CHIME_STEP + CHIME_RING) * 1000 + CHIME_TAIL_MS;
    speakingUntil = Math.max(speakingUntil, performance.now() + totalMs);
    setTimeout(function () { if (tracker && !isSpeaking()) tracker.reset(true); }, totalMs + 5);
  }

  function isSpeaking() { return performance.now() < speakingUntil; }

  /* ========================================================================
   * 4. Microphone and listening
   * ===================================================================== */

  var analyser = null;
  var tracker = null;
  var frame = null;
  var calibration = null;    // levels gathered while the room is quiet
  var latest = null;         // last tracker reading, for the live display

  function startMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error(location.protocol === 'file:'
        ? 'This browser won’t use the microphone on a page opened from a file. Open it from the website (or a local server) instead.'
        : 'This browser can’t use the microphone here. Try Chrome, Safari or Firefox, on an https page.'));
    }
    var ctx = getContext();
    // Raw sound: the browser's voice processing would dull and gate the guitar.
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      var source = ctx.createMediaStreamSource(stream);
      // Keep only the guitar's range: cuts rumble (fans, knocks) and hiss,
      // so quiet notes, especially on the high E string, stand out from the room.
      var highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = MIC_LOW_CUT;
      var lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = MIC_HIGH_CUT;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(analyser);   // not to the speakers
      tracker = new PD.NoteTracker({ sampleRate: ctx.sampleRate });
      calibration = [];
      listen();
    });
  }

  function listen() {
    var buffer = new Float32Array(analyser.fftSize);
    function step() {
      frame = requestAnimationFrame(step);
      analyser.getFloatTimeDomainData(buffer);

      if (calibration) {
        calibration.push(PD.rms(buffer));
        if (calibration.length >= 50) {   // ~0.8 s of room sound
          tracker.calibrate(calibration);
          calibration = null;
          showCheck();
        }
        return;
      }

      latest = tracker.push(buffer);
      if (isSpeaking()) { latest.event = null; latest.paused = true; }
      if (latest.event) onNoteHeard(latest.event);
      renderLive();
    }
    step();
  }

  /* ========================================================================
   * 5. Melodies
   * ===================================================================== */

  /** Every note of the key's major scale within the range. */
  function scaleNotes() {
    var root = KEYS[settings.key];
    var notes = [];
    for (var midi = RANGE_LOW; midi <= RANGE_HIGH; midi++) {
      if (MAJOR_SCALE.indexOf(((midi - root) % 12 + 12) % 12) >= 0) notes.push(midi);
    }
    return notes;
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /**
   * A singable melody: starts on the 1st, 3rd or 5th of the key near the
   * middle of the range, then moves mostly by step with the odd small leap.
   */
  function makeMelody(length, previous) {
    var pool = scaleNotes();
    var root = KEYS[settings.key];
    if (length === 1) {
      var options = pool.filter(function (midi) { return !previous || midi !== previous[0]; });
      return [pick(options)];
    }
    var anchors = pool.filter(function (midi) {
      return [0, 4, 7].indexOf(((midi - root) % 12 + 12) % 12) >= 0 && midi >= 50 && midi <= 62;
    });
    var notes = [pick(anchors)];
    var at = pool.indexOf(notes[0]);
    while (notes.length < length) {
      var next = at + pick([-2, -1, -1, 1, 1, 2, -3, 3]);
      if (next < 0 || next >= pool.length || next === at) continue;
      at = next;
      notes.push(pool[at]);
    }
    return notes;
  }

  /** Where a note is on the neck, frets 0–12, up to three places. */
  function positions(midi) {
    var found = [];
    OPEN_STRINGS.forEach(function (string) {
      var fret = midi - string.midi;
      if (fret >= 0 && fret <= 12) found.push(fret === 0 ? 'open ' + string.name : string.name + ' string, fret ' + fret);
    });
    return found.slice(0, 3);
  }

  /* ========================================================================
   * 6. Rounds, judging and help
   * ===================================================================== */

  function startRound() {
    clearTimeout(nextRoundTimer);
    var level = LEVELS[settings.level];
    round = {
      notes: makeMelody(level.length, round && round.notes),
      index: 0, results: [], phase: 'listen', wrong: 0, wrongNotes: [], help: 0, revealed: false, noteStart: 0
    };
    lastFound = null;
    lastJudged = null;
    setMessage('');
    render();
    playPrompt(round.notes, TEMPO).then(function () {
      if (!round || round.phase !== 'listen') return;
      round.phase = 'play';
      round.noteStart = performance.now();
      render();
    });
  }

  function matches(played, target) {
    return settings.exactOctave ? played === target : (played - target) % 12 === 0;
  }

  function onNoteHeard(event) {
    if (!round || round.phase !== 'play') {
      if (!round) noteDuringCheck(event);
      return;
    }
    // The tracker may correct its last note an octave down (low-string attack).
    if (event.corrects !== undefined && lastJudged && lastJudged.midi === event.corrects && lastJudged.wasWrong) {
      round.wrong = Math.max(0, round.wrong - 1);
      round.wrongNotes.pop();
    }
    // The note just found, still sounding or re-struck at once, isn't a wrong try.
    var now = performance.now();
    if (lastFound && matches(event.midi, lastFound.midi) && now - lastFound.time < 800) return;

    var target = round.notes[round.index];
    if (matches(event.midi, target)) noteFound(event, target, now);
    else noteWrong(event);
  }

  /** 0–1: how well a note was found (fast, few wrong tries, little help). */
  function noteQuality(seconds, wrong, help) {
    var speed = Math.max(0.3, Math.min(1, 1 - (seconds - 2) / 20));
    var accuracy = Math.max(0.4, 1 - wrong * 0.1);
    return speed * accuracy * HELP_WEIGHT[help];
  }

  function noteFound(event, target, now) {
    var seconds = (now - round.noteStart) / 1000;
    round.results.push({ midi: target, seconds: seconds, wrong: round.wrong, help: round.help, quality: noteQuality(seconds, round.wrong, round.help) });
    logNote(true, seconds);
    lastFound = { midi: event.midi, time: now };
    lastJudged = { midi: event.midi, wasWrong: false };
    round.index++;

    if (round.index >= round.notes.length) { finishRound(); return; }
    playChime(CHIME_NOTE);
    round.wrong = 0;
    round.wrongNotes = [];
    round.help = 0;
    round.revealed = false;
    round.noteStart = now;
    setMessage(pitchName(target) + ' · ' + seconds.toFixed(1) + ' s. Now the next one.', 'good');
    render();
  }

  function noteWrong(event) {
    round.wrong++;
    round.wrongNotes.push(event.midi);
    lastJudged = { midi: event.midi, wasWrong: true };
    // Only name what was played: finding the way to the target is the student's job.
    setMessage('That’s ' + pitchName(event.midi) + '.', 'nudge');
    render();
    checkHelp();
  }

  /** Step in when the student has searched long enough or missed often enough. */
  function checkHelp() {
    if (!round || round.phase !== 'play' || isSpeaking() || round.help >= HELP_STEPS.length) return;
    var step = HELP_STEPS[round.help];
    var seconds = (performance.now() - round.noteStart) / 1000;
    if (seconds >= step.seconds || round.wrong >= step.wrong) giveHelp(round.help + 1);
  }

  function giveHelp(level) {
    if (!round || round.phase !== 'play') return;
    round.help = Math.max(round.help, level);
    var i = round.index;
    var target = round.notes[i];
    if (level === 1) {
      setMessage('Let me play it slower.', 'nudge');
      replay(round.notes, SLOW_TEMPO);
    } else if (level === 2) {
      if (i === 0) {
        setMessage('Just the first note. Find this one first.', 'nudge');
        replay([target, target], SLOW_TEMPO, [0, 0]);
      } else {
        setMessage('From the note you found, to the next one.', 'nudge');
        replay([round.notes[i - 1], target], SLOW_TEMPO, [i - 1, i]);
      }
    } else {
      round.revealed = true;
      setMessage('It’s ' + noteName(target) + ': ' + positions(target).join(' · ') + '. Play it.', 'nudge');
      replay([target], SLOW_TEMPO, [i]);
    }
    render();
  }

  /** Replay during the search; the search clock stops while the app plays. */
  function replay(notes, tempo, slots) {
    if (!round || isSpeaking()) return;
    var started = performance.now();
    playPrompt(notes, tempo, slots).then(function () {
      if (round && round.phase === 'play') round.noteStart += performance.now() - started;
    });
  }

  function finishRound() {
    round.phase = 'done';
    playChime(CHIME_ROUND);
    var quality = average(round.results, function (r) { return r.quality; });
    var seconds = round.results.reduce(function (sum, r) { return sum + r.seconds; }, 0);
    var mostHelp = round.results.reduce(function (most, r) { return Math.max(most, r.help); }, 0);
    var good = quality >= 0.6 && mostHelp <= 1;
    var poor = mostHelp >= 3 || quality < 0.3;
    history.rounds.push({ length: round.notes.length, found: true, seconds: Math.round(seconds * 10) / 10 });
    saveHistory();

    var found = (round.notes.length === 1 ? 'Found' : 'Melody found') + ' in ' + seconds.toFixed(1) + ' s.';
    var text = good ? 'Nice. ' + found : found + ' Keep going.';

    if (good) {
      stats.goodRounds++;
      stats.poorRounds = 0;
      if (stats.goodRounds >= ROUNDS_TO_LEVEL_UP && settings.level < LEVELS.length - 1) {
        settings.level++;
        stats.goodRounds = 0;
        text = 'Level up: ' + LEVELS[settings.level].name.toLowerCase() + '.';
      }
    } else if (poor) {
      stats.poorRounds++;
      stats.goodRounds = 0;
      if (stats.poorRounds >= ROUNDS_TO_EASE && settings.level > 0) {
        settings.level--;
        stats.poorRounds = 0;
        text = 'Let’s make it a bit easier: ' + LEVELS[settings.level].name.toLowerCase() + '.';
      }
    }
    save();
    setMessage(text, 'good');
    render();
    nextRoundTimer = setTimeout(startRound, NEXT_ROUND_DELAY_MS);
  }

  function skip() {
    if (!round) return;
    if (round.phase === 'done') { startRound(); return; }
    if (round.phase === 'play') {
      logNote(false, (performance.now() - round.noteStart) / 1000);
      history.rounds.push({ length: round.notes.length, found: false, seconds: 0 });
      saveHistory();
    }
    stats.goodRounds = 0;
    round.phase = 'done';
    setMessage('It was ' + round.notes.map(noteName).join(' – ') + '.', 'nudge');
    render();
    nextRoundTimer = setTimeout(startRound, NEXT_ROUND_DELAY_MS);
  }

  /* ========================================================================
   * 7. Rendering
   * ===================================================================== */

  function setMessage(text, tone) { message = { text: text, tone: tone || '' }; }

  function render() {
    if (!round) return;
    var level = LEVELS[settings.level];
    byId('earLevel').innerHTML = 'Level ' + (settings.level + 1) + '<span class="ear-level-name"> · ' + level.name + '</span>';
    byId('earKey').textContent = 'Key of ' + settings.key;

    var headline = { listen: 'Listen…', play: 'Your turn', done: 'Round done' }[round.phase];
    if (round.phase === 'play' && round.notes.length > 1) headline = 'Find note ' + (round.index + 1) + ' of ' + round.notes.length;
    byId('earHeadline').textContent = headline;

    byId('earSlots').innerHTML = round.notes.map(function (midi, i) {
      var result = round.results[i];
      var state = result ? 'is-found' : (round.phase === 'play' && i === round.index ? 'is-current' : '');
      if (!result && round.phase === 'done') state = 'is-missed';
      if (i === round.index && round.revealed && !result) state += ' is-revealed';
      var label = result || round.phase === 'done' || (i === round.index && round.revealed) ? pitchName(midi) : '?';
      var sub = result ? result.seconds.toFixed(1) + ' s' : '';
      return '<div class="ear-slot ' + state + '" data-slot="' + i + '"><span>' + label + '</span><small>' + sub + '</small></div>';
    }).join('');

    var messageEl = byId('earMessage');
    messageEl.textContent = message.text;
    messageEl.className = 'ear-message' + (message.tone ? ' is-' + message.tone : '');

    byId('earHint').disabled = round.phase !== 'play' || round.help >= HELP_STEPS.length;
    byId('earSlower').disabled = round.phase === 'listen';
    byId('earReplay').disabled = round.phase === 'listen';
    byId('earNext').textContent = round.phase === 'done' ? 'Next' : 'Skip';
    renderLive();
    renderBoard();
  }

  function flashSlot(index) {
    var slot = document.querySelector('.ear-slot[data-slot="' + index + '"]');
    if (!slot) return;
    slot.classList.remove('is-playing');
    void slot.offsetWidth;
    slot.classList.add('is-playing');
  }

  /** "You're playing" panel: note, tuning, input level, and whether the app is listening. */
  function renderLive() {
    var target = round ? byId('earLive') : byId('earCheck');
    if (!target || !latest) return;
    var note = target.querySelector('.ear-live-note');
    var needle = target.querySelector('.ear-needle');
    var meter = target.querySelector('.ear-level i');
    var status = target.querySelector('.ear-live-status');

    var speaking = isSpeaking();
    var hasNote = !speaking && latest.midi !== null && !latest.gated;
    note.textContent = hasNote ? noteName(latest.midi) : '—';
    needle.style.left = (50 + (hasNote ? latest.cents : 0)) + '%';
    meter.style.width = Math.min(100, Math.round(latest.level / (tracker.gate * 8) * 100)) + '%';
    status.textContent = speaking ? 'Not listening while I play' : (latest.gated ? 'Listening…' : 'Hearing you');
    target.classList.toggle('is-paused', speaking);
  }


  /* ========================================================================
   * 8. Fretboard and keyboard
   *
   * One board under the game, shown as a fretboard (frets 0–12, styled like
   * the main visualiser) or a keyboard (A2–C5). It shows:
   *   found notes        every place the note is, lit with its name
   *   help 1 (zone)      a 4-fret area to look in (keyboard: the octave)
   *   help 2 (string)    the string inside that area (keyboard: 3 keys)
   *   help 3 (reveal)    the exact spot, with its name
   *   round over         the whole melody
   * The clue spot is chosen once per note (the position nearest fret 3, the
   * friendliest part of the neck) so each clue narrows the last one.
   * ===================================================================== */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var BOARD_FRETS = 12;
  var KEYBOARD_LOW = 45;    // A2
  var KEYBOARD_HIGH = 72;   // C5
  var CLUE_FRET = 3;

  function svgElement(name, attributes, text) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attributes).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Every [string, fret] (frets 0–12) that sounds this exact note; string 0 = high E. */
  function fretPositions(midi) {
    var found = [];
    OPEN_STRINGS.forEach(function (string, index) {
      var fret = midi - string.midi;
      if (fret >= 0 && fret <= BOARD_FRETS) found.push([index, fret]);
    });
    return found;
  }

  function cluePosition(midi) {
    return fretPositions(midi).sort(function (a, b) {
      return Math.abs(a[1] - CLUE_FRET) - Math.abs(b[1] - CLUE_FRET) || b[0] - a[0];
    })[0];
  }

  /** What the board should show right now. */
  function boardState() {
    var lit = [];   // { midi, kind: 'found' | 'latest' | 'reveal' | 'answer' }
    var clue = null;
    if (!round) return { lit: lit, clue: clue };
    round.results.forEach(function (result, i) {
      lit.push({ midi: result.midi, kind: i === round.results.length - 1 && round.phase === 'play' ? 'latest' : 'found' });
    });
    if (round.phase === 'done') {
      round.notes.forEach(function (midi, i) { if (!round.results[i]) lit.push({ midi: midi, kind: 'answer' }); });
    } else if (round.phase === 'play' && round.help > 0) {
      var target = round.notes[round.index];
      if (round.help >= 3) lit.push({ midi: target, kind: 'reveal' });
      else clue = { level: round.help, midi: target, position: cluePosition(target) };
    }
    return { lit: lit, clue: clue };
  }

  function renderBoard() {
    var board = byId('earBoard');
    if (!board) return;
    var view = settings.view === 'keyboard' ? 'keyboard' : 'fretboard';
    byId('earVisualLabel').textContent = view === 'keyboard' ? 'On the keys' : 'On the neck';
    byId('earView').querySelectorAll('button').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.view === view);
    });
    var state = boardState();
    board.innerHTML = '';
    board.appendChild(view === 'keyboard' ? drawKeyboard(state) : drawFretboard(state));
  }

  function drawFretboard(state) {
    var width = 1000, openWidth = 54, top = 26, row = 36;
    var height = top * 2 + row * 5 + 30;
    var widths = [];
    for (var f = 1; f <= BOARD_FRETS; f++) widths.push(Math.pow(0.9727, f - 1));
    var scale = (width - openWidth) / widths.reduce(function (a, b) { return a + b; }, 0);
    var wireX = [openWidth];
    widths.forEach(function (w) { wireX.push(wireX[wireX.length - 1] + w * scale); });
    var centre = function (fret) { return fret === 0 ? openWidth / 2 : (wireX[fret - 1] + wireX[fret]) / 2; };
    var y = function (string) { return top + string * row; };

    // The view box starts left of 0 to fit the string names before the nut.
    var svg = svgElement('svg', { viewBox: '-30 0 ' + (width + 30) + ' ' + height, role: 'img', 'aria-label': 'Guitar fretboard' });
    var gradient = svgElement('linearGradient', { id: 'earStringGradient', x1: 0, x2: 1, y1: 0, y2: 0 });
    [['0', '#3f9a98'], ['.5', '#4c98a0'], ['.78', '#8c93b5'], ['1', '#cf8fbd']].forEach(function (stop) {
      gradient.appendChild(svgElement('stop', { offset: stop[0], 'stop-color': stop[1] }));
    });
    var defs = svgElement('defs', {});
    defs.appendChild(gradient);
    svg.appendChild(defs);

    [3, 5, 7, 9, 12].forEach(function (fret) {
      var w = wireX[fret] - wireX[fret - 1];
      svg.appendChild(svgElement('rect', { x: wireX[fret - 1] + w * 0.27, y: top + row * 0.6, width: w * 0.46, height: row * 3.8, fill: '#2b2216', rx: 1 }));
    });

    // Clue: a 4-fret zone, then the string inside it.
    if (state.clue) {
      var fretAt = state.clue.position[1];
      var from = Math.max(0, Math.min(fretAt - 1, BOARD_FRETS - 3));
      var left = from === 0 ? 0 : wireX[from - 1];
      var right = wireX[Math.min(BOARD_FRETS, from + 3)];
      svg.appendChild(svgElement('rect', {
        class: 'ear-clue-zone', x: left + 2, y: top - 18, width: right - left - 4, height: row * 5 + 36, rx: 12
      }));
      if (state.clue.level >= 2) {
        svg.appendChild(svgElement('rect', {
          class: 'ear-clue-string', x: left + 6, y: y(state.clue.position[0]) - 11, width: right - left - 12, height: 22, rx: 11
        }));
      }
    }

    for (var s = 0; s < 6; s++) {
      svg.appendChild(svgElement('rect', { x: 0, y: y(s), width: width, height: 1.2 + s * 0.55, fill: 'url(#earStringGradient)' }));
      svg.appendChild(svgElement('text', { x: -10, y: y(s) + 4, 'text-anchor': 'end', class: 'ear-board-label' }, OPEN_STRINGS[s].name.replace('high ', '').replace('low ', '')));
    }
    wireX.forEach(function (x, i) {
      svg.appendChild(svgElement('rect', { x: x - 1, y: top, width: i === 0 ? 3 : 1.6, height: row * 5 + 2, fill: '#ebe8e1' }));
    });
    for (f = 0; f <= BOARD_FRETS; f++) {
      svg.appendChild(svgElement('text', { x: centre(f), y: height - 4, 'text-anchor': 'middle', class: 'ear-board-number' }, f));
    }

    state.lit.forEach(function (note) {
      fretPositions(note.midi).forEach(function (position) {
        var group = svgElement('g', { class: 'ear-dot is-' + note.kind });
        group.appendChild(svgElement('circle', { cx: centre(position[1]), cy: y(position[0]), r: 15 }));
        group.appendChild(svgElement('text', { x: centre(position[1]), y: y(position[0]) + 5, 'text-anchor': 'middle' }, pitchName(note.midi)));
        svg.appendChild(group);
      });
    });
    return svg;
  }

  function drawKeyboard(state) {
    var whites = [];
    for (var midi = KEYBOARD_LOW; midi <= KEYBOARD_HIGH; midi++) if (NOTE_NAMES[midi % 12].length === 1) whites.push(midi);
    var width = 1000, whiteWidth = width / whites.length, height = 210, blackHeight = 128;
    var svg = svgElement('svg', { viewBox: '0 0 ' + width + ' ' + (height + 4), role: 'img', 'aria-label': 'Keyboard' });
    var litByMidi = {};
    state.lit.forEach(function (note) { litByMidi[note.midi] = note.kind; });

    // Clue: the octave, then a 3-key window (exact key comes with the reveal).
    var clueKeys = {};
    if (state.clue) {
      var target = state.clue.midi;
      var lowKey = state.clue.level >= 2 ? target - 1 : target - (target % 12);
      var highKey = state.clue.level >= 2 ? target + 1 : lowKey + 11;
      for (midi = lowKey; midi <= highKey; midi++) clueKeys[midi] = true;
    }

    function keyClass(midi, black) {
      var kind = litByMidi[midi];
      return 'ear-key' + (black ? ' is-black' : '') + (kind ? ' is-' + kind : '') + (clueKeys[midi] && !kind ? ' is-clue' : '');
    }

    whites.forEach(function (midi, i) {
      var x = i * whiteWidth;
      svg.appendChild(svgElement('rect', { class: keyClass(midi, false), x: x + 1, y: 2, width: whiteWidth - 2, height: height, rx: 6 }));
      var label = litByMidi[midi] ? pitchName(midi) : (midi % 12 === 0 ? noteName(midi) : '');
      if (label) svg.appendChild(svgElement('text', {
        class: 'ear-key-label' + (litByMidi[midi] ? ' is-lit' : ''), x: x + whiteWidth / 2, y: height - 14, 'text-anchor': 'middle'
      }, label));
    });
    whites.forEach(function (midi, i) {
      var black = midi + 1;
      if (black > KEYBOARD_HIGH || NOTE_NAMES[black % 12].length === 1) return;
      var x = (i + 1) * whiteWidth - whiteWidth * 0.31;
      svg.appendChild(svgElement('rect', { class: keyClass(black, true), x: x, y: 2, width: whiteWidth * 0.62, height: blackHeight, rx: 4 }));
      if (litByMidi[black]) {
        svg.appendChild(svgElement('text', { class: 'ear-key-label is-lit', x: x + whiteWidth * 0.31, y: blackHeight - 12, 'text-anchor': 'middle' }, pitchName(black)));
      }
    });
    return svg;
  }


  /* ========================================================================
   * 9. Feedback
   *
   * Every note searched for is logged (kept in this browser across visits).
   * The Feedback panel turns the log into averages and weak areas: groups of
   * notes (by interval from the previous note, direction, note name, first
   * note vs later, low vs high) that take clearly longer than the student's
   * own average. "Effort" for a note = seconds + 3 s per wrong try, so slow
   * and error-prone both count. A group needs 3+ notes to be judged.
   * ===================================================================== */

  var HISTORY_KEY = 'fretnoodle.earTraining.history';
  var HISTORY_NOTES = 400;
  var HISTORY_ROUNDS = 150;
  var MIN_GROUP = 3;
  var WEAK_RATIO = 1.3;     // effort this much above average = weak area
  var STRONG_RATIO = 0.8;   // and this much below = strength
  var history = { notes: [], rounds: [] };

  function loadHistory() {
    try {
      var saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
      if (saved && Array.isArray(saved.notes) && Array.isArray(saved.rounds)) history = saved;
    } catch (error) { /* storage unavailable */ }
  }

  function saveHistory() {
    history.notes = history.notes.slice(-HISTORY_NOTES);
    history.rounds = history.rounds.slice(-HISTORY_ROUNDS);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (error) { /* storage unavailable */ }
  }

  /** Log the note being searched for (found or given up on). */
  function logNote(found, seconds) {
    var i = round.index;
    history.notes.push({
      midi: round.notes[i], prev: i > 0 ? round.notes[i - 1] : null, index: i, found: found,
      seconds: Math.round(seconds * 10) / 10, wrong: round.wrong, wrongNotes: round.wrongNotes.slice(), help: round.help
    });
  }

  function average(list, pick) {
    return list.length ? list.reduce(function (sum, item) { return sum + pick(item); }, 0) / list.length : 0;
  }

  function effort(note) { return note.seconds + note.wrong * 3 + (note.found ? 0 : 20); }

  function intervalGroup(note) {
    var distance = Math.abs(note.midi - note.prev);
    if (distance <= 2) return 'Steps to the next note';
    if (distance <= 4) return 'Jumps of a 3rd';
    if (distance <= 7) return 'Jumps of a 4th or 5th';
    return 'Big leaps';
  }

  /** @returns {{notes:number, melodies:number, perNote:number, perMelody:number, wrong:number, weak:Array, strong:Object|null}} */
  function analyse() {
    var notes = history.notes;
    var found = notes.filter(function (n) { return n.found; });
    var melodies = history.rounds.filter(function (r) { return r.found; });
    var overall = average(notes, effort);
    var groups = {};
    function add(label, note) { (groups[label] = groups[label] || []).push(note); }

    notes.forEach(function (note) {
      add('Finding ' + pitchName(note.midi), note);
      add(note.midi < 52 ? 'Low notes (below E3)' : note.midi >= 60 ? 'High notes (C4 and up)' : 'Middle notes', note);
      if (note.prev !== null) {
        add(intervalGroup(note), note);
        if (note.midi !== note.prev) add(note.midi > note.prev ? 'Melodies going up' : 'Melodies going down', note);
        add('Notes after the first', note);
      } else if (history.rounds.some(function (r) { return r.length > 1; })) {
        add('The first note of a melody', note);
      }
    });

    var rated = Object.keys(groups).filter(function (label) { return groups[label].length >= MIN_GROUP; }).map(function (label) {
      var list = groups[label];
      return {
        label: label, count: list.length, ratio: overall ? average(list, effort) / overall : 1,
        seconds: average(list.filter(function (n) { return n.found; }), function (n) { return n.seconds; }),
        wrong: average(list, function (n) { return n.wrong; })
      };
    });
    var weak = rated.filter(function (g) { return g.ratio >= WEAK_RATIO; }).sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, 3);
    var strong = rated.filter(function (g) { return g.ratio <= STRONG_RATIO; }).sort(function (a, b) { return a.ratio - b.ratio; })[0] || null;

    // Patterns in the wrong notes and in how much help was needed.
    var wrongs = [];
    notes.forEach(function (n) { (n.wrongNotes || []).forEach(function (w) { wrongs.push((((n.midi - w) % 12) + 12) % 12); }); });
    var oneFret = wrongs.filter(function (d) { return d === 1 || d === 11; }).length;
    var bigHelp = notes.filter(function (n) { return n.help >= 2; }).length;
    var patterns = [];
    if (wrongs.length >= 5 && oneFret / wrongs.length >= 0.4) {
      patterns.push(Math.round(oneFret / wrongs.length * 100) + '% of your wrong notes are just one fret away. You’re close: listen carefully to the last step.');
    }
    if (notes.length >= 5 && bigHelp / notes.length >= 0.25) {
      patterns.push('You needed “just this note” or the answer on ' + Math.round(bigHelp / notes.length * 100) + '% of notes. Try singing the note before you search.');
    }

    return {
      notes: found.length, melodies: melodies.length,
      perNote: average(found, function (n) { return n.seconds; }),
      perMelody: average(melodies, function (r) { return r.seconds; }),
      wrong: average(notes, function (n) { return n.wrong; }),
      weak: weak, strong: strong, patterns: patterns
    };
  }

  function describeGroup(group) {
    var parts = [];
    if (group.seconds) parts.push(group.seconds.toFixed(1) + ' s to find');
    parts.push(group.wrong.toFixed(1) + ' wrong ' + (group.wrong.toFixed(1) === '1.0' ? 'try' : 'tries'));
    return '<strong>' + group.label + '</strong><span>' + parts.join(' · ') + ' on average (' + group.count + ' notes)</span>';
  }

  function renderFeedback() {
    var result = analyse();
    var body = byId('earFeedbackBody');
    if (!history.notes.length) {
      body.innerHTML = '<p class="ear-feedback-empty">Play a few melodies first. Feedback appears here as you go.</p>';
      return;
    }
    var tiles = [
      [result.perNote ? result.perNote.toFixed(1) + ' s' : '—', 'to find a note'],
      [result.perMelody ? result.perMelody.toFixed(1) + ' s' : '—', 'to find a whole melody'],
      [result.wrong.toFixed(1), 'wrong notes before the right one']
    ];
    var html = '<div class="ear-feedback-tiles">' + tiles.map(function (tile) {
      return '<div><b>' + tile[0] + '</b><span>' + tile[1] + '</span></div>';
    }).join('') + '</div>';

    html += '<div class="ear-feedback-section"><span class="eyebrow">Weak areas</span>';
    if (result.weak.length) {
      html += '<ul class="ear-feedback-list is-weak">' + result.weak.map(function (g) { return '<li>' + describeGroup(g) + '</li>'; }).join('') + '</ul>';
    } else {
      html += '<p class="ear-feedback-empty">' + (history.notes.length < 10 ? 'Play a few more melodies to see your weak areas.' : 'Nothing stands out. You’re even across the board.') + '</p>';
    }
    if (result.patterns.length) {
      html += '<ul class="ear-feedback-list is-pattern">' + result.patterns.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>';
    }
    html += '</div>';
    if (result.strong) {
      html += '<div class="ear-feedback-section"><span class="eyebrow">Strongest</span><ul class="ear-feedback-list is-strong"><li>' + describeGroup(result.strong) + '</li></ul></div>';
    }
    html += '<p class="hint">Based on ' + history.notes.length + ' notes in ' + history.rounds.length + ' melodies. <button type="button" class="ear-link" id="earClearHistory">Clear history</button></p>';
    body.innerHTML = html;
  }

  function toggleFeedback(open) {
    var panel = byId('earFeedback');
    var show = open === undefined ? panel.hidden : open;
    panel.hidden = !show;
    byId('earFeedbackButton').setAttribute('aria-expanded', show);
    if (show) renderFeedback();
  }

  /* ========================================================================
   * 10. Events and start-up
   * ===================================================================== */

  function showError(text) {
    var el = byId('earError');
    el.textContent = text;
    el.hidden = false;
  }

  function setUpSettings() {
    var keyGroup = byId('earKeys');
    keyGroup.innerHTML = Object.keys(KEYS).map(function (key) {
      return '<button type="button" data-key="' + key + '" aria-pressed="' + (settings.key === key) + '">' + key + '</button>';
    }).join('');
    keyGroup.addEventListener('click', function (event) {
      var button = event.target.closest('[data-key]');
      if (!button) return;
      settings.key = button.dataset.key;
      keyGroup.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === button); });
      save();
    });

    var levelGroup = byId('earLevels');
    levelGroup.innerHTML = LEVELS.map(function (level, i) {
      return '<button type="button" data-level="' + i + '" aria-pressed="' + (settings.level === i) + '">' + level.length + (level.length === 1 ? ' note' : ' notes') + '</button>';
    }).join('');
    levelGroup.addEventListener('click', function (event) {
      var button = event.target.closest('[data-level]');
      if (!button) return;
      settings.level = Number(button.dataset.level);
      stats.goodRounds = 0;
      stats.poorRounds = 0;
      levelGroup.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === button); });
      save();
    });

    var octave = byId('earOctave');
    octave.setAttribute('aria-checked', settings.exactOctave);
    octave.addEventListener('click', function () {
      settings.exactOctave = !settings.exactOctave;
      octave.setAttribute('aria-checked', settings.exactOctave);
      save();
    });
  }

  function onMicButton() {
    var button = byId('earMicButton');
    button.disabled = true;
    button.textContent = 'Loading sounds…';
    byId('earError').hidden = true;
    loadSamples()
      .then(function () {
        button.textContent = 'Allow the microphone…';
        return startMicrophone();
      })
      .then(function () {
        button.hidden = true;
        byId('earCalibrating').hidden = false;
      })
      .catch(function (error) {
        button.disabled = false;
        button.textContent = 'Turn on microphone';
        var text = 'Something went wrong starting the microphone.';
        if (error && error.name === 'NotAllowedError') text = 'The microphone is blocked. Allow it in your browser’s address bar, then try again.';
        else if (error && error.name === 'NotFoundError') text = 'No microphone found. Plug one in or check your sound settings.';
        else if (error && error.name === 'NotReadableError') text = 'Another app is using the microphone. Close it and try again.';
        else if (error && error.message) text = error.message;
        showError(text);
      });
  }

  /** After calibration: play any note to check the app hears the guitar. */
  function showCheck() {
    byId('earCalibrating').hidden = true;
    byId('earCheck').hidden = false;
    byId('earStart').hidden = false;
  }

  function noteDuringCheck(event) {
    byId('earCheckResult').textContent = 'I hear you: ' + noteName(event.midi) + ' ✓';
  }

  function startGame() {
    byId('earSetup').hidden = true;
    byId('earGame').hidden = false;
    document.body.classList.add('is-ear-playing');   // phones hide the intro while playing
    startRound();
  }

  function bindEvents() {
    byId('earMicButton').addEventListener('click', onMicButton);
    byId('earStart').addEventListener('click', startGame);
    byId('earReplay').addEventListener('click', function () { if (round) replay(round.notes, TEMPO); });
    byId('earSlower').addEventListener('click', function () {
      if (!round) return;
      if (round.phase === 'play') round.help = Math.max(round.help, 1);
      replay(round.notes, SLOW_TEMPO);
      render();
    });
    byId('earHint').addEventListener('click', function () { if (round) giveHelp(round.help + 1); });
    byId('earNext').addEventListener('click', skip);
    byId('earFeedbackButton').addEventListener('click', function () { toggleFeedback(); });
    byId('earFeedbackClose').addEventListener('click', function () { toggleFeedback(false); });
    byId('earFeedbackBody').addEventListener('click', function (event) {
      if (event.target.id !== 'earClearHistory') return;
      history = { notes: [], rounds: [] };
      saveHistory();
      renderFeedback();
    });
    byId('earView').addEventListener('click', function (event) {
      var button = event.target.closest('[data-view]');
      if (!button) return;
      settings.view = button.dataset.view;
      save();
      renderBoard();
    });
    byId('earSettings').addEventListener('click', function () {
      clearTimeout(nextRoundTimer);
      round = null;
      byId('earGame').hidden = true;
      byId('earSetup').hidden = false;
      document.body.classList.remove('is-ear-playing');
    });

    window.addEventListener('keydown', function (event) {
      if (!round || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target && /INPUT|TEXTAREA|BUTTON/.test(event.target.tagName) && event.key === ' ') return;
      if (event.key === ' ') { event.preventDefault(); replay(round.notes, TEMPO); }
      else if (event.key === 'h' || event.key === 'H') giveHelp(round.help + 1);
      else if (event.key === 'n' || event.key === 'N') skip();
    });

    setInterval(checkHelp, 500);
  }

  load();
  loadHistory();
  setUpSettings();
  bindEvents();
})();
