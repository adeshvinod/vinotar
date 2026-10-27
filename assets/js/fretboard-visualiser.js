/**
 * Fretnoodle — Fretboard Visualiser
 *
 * Drives fretboard-visualiser.html. Plain JavaScript, no dependencies, works
 * straight from the file system (no server needed).
 *
 * How it fits together
 *   - All app data lives in one `state` object. Every change goes through
 *     setState(), which re-renders the page from that state.
 *   - The fretboard DOM (19 fret columns × 6 strings) is built once at start-up
 *     so note dots can animate with CSS transitions instead of being recreated.
 *   - Buttons declare what they do with data-action="…"; one delegated click
 *     listener dispatches to the matching function in `actions`.
 *
 * Musical conventions
 *   - Pitch classes are integers 0–11 with C = 0 (C, Db, D … B). Flats only.
 *   - Strings are numbered by row: 0 = high E (top) … 5 = low E (bottom).
 *   - A fret position is a [string, fret] pair; fret 0 is the open string.
 *   - A chord is whatever notes the user entered. Its name is worked out from
 *     those notes, the same way the original visualiser's chordanalyze() did.
 *
 * Sections
 *   1. Constants and music data
 *   2. State
 *   3. Music helpers (tuning, chord analysis, voicings)
 *   4. Sound (metronome click, guitar samples)
 *   5. Fretboard DOM
 *   6. Chord transitions
 *   7. Paint
 *   8. MIDI input
 *   9. Rendering
 *  10. Playback and navigation
 *  11. Editing (note entry, transpose, tuning)
 *  12. Actions and event wiring
 *  13. Saving and loading (used by fretboard-session.js)
 */
(function () {
  'use strict';

  /* ========================================================================
   * 1. Constants and music data
   * ===================================================================== */

  var NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  /** Interval labels by semitone distance from the root. */
  var INTERVAL_LABELS = ['R', 'b2', 'M2', 'b3', 'M3', 'P4', 'b5', 'P5', 'b6', 'M6', 'b7', 'M7'];

  var STRING_COUNT = 6;
  var FRET_COUNT = 18;   // frets 0 (open) to 18

  /** Standard tuning per string, high E to low E. */
  var STANDARD_PITCH_CLASSES = [4, 11, 7, 2, 9, 4];   // E B G D A E
  var STANDARD_MIDI_NOTES = [64, 59, 55, 50, 45, 40]; // E4 B3 G3 D3 A2 E2

  /** Frets with an inlay marker. */
  var INLAY_FRETS = { 3: true, 5: true, 7: true, 9: true, 12: true, 15: true };

  /** Fretboard geometry (design handoff, section 5). */
  var OPEN_STRING_COLUMN_WIDTH = '0 0 64px';
  var FRET_WIDTH_RATIO = 0.9727;   // each fret is this fraction of the one before
  var STRING_ROW_HEIGHT = 54;      // px
  var FIRST_STRING_CENTER = 27;    // px from the top of the board

  /** Qualities offered by the Add chord picker, in display order. */
  var PICKER_QUALITIES = [
    { id: 'Maj',     intervals: [0, 4, 7] },
    { id: 'min',     intervals: [0, 3, 7] },
    { id: '7',       intervals: [0, 4, 7, 10] },
    { id: 'Maj7',    intervals: [0, 4, 7, 11] },
    { id: 'min7',    intervals: [0, 3, 7, 10] },
    { id: 'minMaj7', intervals: [0, 3, 7, 11] },
    { id: '6',       intervals: [0, 4, 7, 9] },
    { id: 'min6',    intervals: [0, 3, 7, 9] },
    { id: 'dim',     intervals: [0, 3, 6] },
    { id: 'dim7',    intervals: [0, 3, 6, 9] },
    { id: 'min7b5',  intervals: [0, 3, 6, 10] },
    { id: 'sus2',    intervals: [0, 2, 7] },
    { id: 'sus4',    intervals: [0, 5, 7] },
    { id: 'aug',     intervals: [0, 4, 8] },
    { id: 'add9',    intervals: [0, 4, 7, 2] },
    { id: '9',       intervals: [0, 4, 7, 10, 2] }
  ];

  /**
   * Chord and scale database from the original visualiser (class.js
   * `chordbase`). Each entry is an ascending interval formula followed by its
   * name. Order matters: when two entries share a formula the first one wins,
   * exactly like the original lookup loop.
   */
  var CHORD_DATABASE = [
    [0, 4, 7, 'maj'], [0, 4, 7, 9, 'maj6'], [0, 4, 7, 11, 'maj7'], [0, 2, 4, 7, 11, 'maj9'],
    [0, 2, 4, 7, 'majAdd9'], [0, 2, 4, 7, 9, 'maj6/9'], [0, 4, 7, 9, 11, 'maj7/6'], [0, 2, 4, 7, 9, 11, 'maj13'],

    [0, 3, 7, 'min'], [0, 3, 7, 9, 'min6'], [0, 3, 7, 10, 'min7'], [0, 2, 3, 7, 10, 'min9'],
    [0, 2, 3, 5, 7, 10, 'min11'], [0, 3, 5, 7, 10, 'min pentatonic'], [0, 3, 5, 7, 9, 'min6 pentatonic'],
    [0, 2, 3, 7, 'minAdd9'], [0, 2, 3, 7, 9, 'min6/9'], [0, 3, 7, 11, 'minMaj7'], [0, 2, 3, 7, 11, 'minMaj9'],

    [0, 4, 7, 10, '7'], [0, 4, 7, 9, 10, '7/6'], [0, 4, 5, 7, 10, '7/11'], [0, 5, 7, 10, '7sus'],
    [0, 5, 7, 9, 10, '7/6sus'], [0, 2, 4, 7, 10, 'dom9'], [0, 2, 4, 5, 7, 10, 'dom11'],
    [0, 2, 4, 7, 9, 10, 'dom13'], [0, 2, 5, 7, 9, 10, '13sus'], [0, 4, 5, 7, 9, 10, '7/6/11'],
    [0, 2, 4, 5, 7, 9, 10, 'dom11/13'], [0, 3, 6, 9, 'dim7'], [0, 3, 4, 7, 10, '7#9'],
    [0, 4, 6, 10, '7b5'], [0, 1, 4, 7, 10, '7b9'], [0, 4, 8, 10, '7#5'],

    [0, 3, 6, 'dim'], [0, 4, 8, 'aug'],

    // Modes of the major scale
    [0, 2, 4, 5, 7, 9, 11, 'ionian'], [0, 2, 3, 5, 7, 9, 10, 'dorian'], [0, 1, 3, 5, 7, 8, 10, 'phrygian'],
    [0, 2, 4, 6, 7, 9, 11, 'lydian'], [0, 2, 4, 5, 7, 9, 10, 'mixolydian'], [0, 2, 3, 5, 7, 8, 10, 'aeolian'],
    [0, 1, 3, 5, 6, 8, 10, 'locrian'],

    // Modes of melodic minor
    [0, 2, 3, 5, 7, 9, 11, 'melodic minor'], [0, 1, 3, 5, 7, 9, 10, 'dorian b2'], [0, 2, 4, 6, 8, 9, 11, 'lydian aug'],
    [0, 2, 4, 6, 7, 9, 10, 'lydian dom'], [0, 2, 4, 5, 7, 8, 10, 'mixolydian b6'], [0, 2, 3, 5, 6, 8, 10, 'aeolian b5'],
    [0, 1, 3, 4, 6, 8, 10, 'superlocrian'],

    // Modes of harmonic minor
    [0, 2, 3, 5, 7, 8, 11, 'harmonic minor'], [0, 1, 3, 5, 6, 9, 10, 'locrian nat6'], [0, 2, 4, 5, 8, 9, 11, 'ionian #5'],
    [0, 2, 3, 6, 7, 9, 10, 'dorian b5'], [0, 1, 4, 5, 7, 8, 10, 'phrygian maj'], [0, 3, 4, 6, 7, 9, 11, 'lydian #9'],
    [0, 1, 3, 4, 6, 8, 9, 'alt dom bb7'],

    [0, 2, 4, 6, 8, 10, 'whole tone'], [0, 3, 6, 10, 'min7b5']
  ];

  /** Dot colours used when "Colour by interval" is on. */
  var INTERVAL_COLORS = {
    root: 'var(--accent)',
    thirds: '#6FD3CF',     // 3, 4
    fifths: '#F2A0CB',     // 6, 7, 8
    sixthsSevenths: '#F6B26B', // 9, 10, 11
    other: '#B8A6FF'       // 1, 2, 5 (2nds, 4ths, 9ths)
  };
  var INTERVAL_LEGEND = [
    { label: 'Root', color: INTERVAL_COLORS.root },
    { label: '3rds', color: INTERVAL_COLORS.thirds },
    { label: '5ths', color: INTERVAL_COLORS.fifths },
    { label: '6ths & 7ths', color: INTERVAL_COLORS.sixthsSevenths },
    { label: '2, 4, 9', color: INTERVAL_COLORS.other }
  ];

  /** Paint brushes: the original orange / blue / pink, and two stroke widths. */
  var BRUSH_COLORS = ['#FF8C00', '#66B2FF', '#FF3399'];
  var BRUSH_WIDTHS = { thin: 3, thick: 6 };   // px, sized against the 2px fret wires and 42px dots
  var ERASER_SIZE = 22;                       // px square

  /** Guitar samples in "guitar sounds/". Notes without a sample are pitch-shifted. */
  var SAMPLE_FOLDER = 'guitar%20sounds/';
  var SAMPLE_NAMES = [
    'D2', 'Dsharp2', 'E2', 'F2', 'Fsharp2', 'G2', 'A2', 'Asharp2', 'B2',
    'C3', 'Csharp3', 'D3', 'Dsharp3', 'E3', 'F3', 'Fsharp3', 'G3', 'Gsharp3', 'A3', 'Asharp3', 'B3',
    'C4', 'Csharp4', 'D4', 'Dsharp4', 'E4', 'F4', 'Fsharp4', 'G4', 'Gsharp4', 'A4', 'Asharp4', 'B4',
    'C5', 'Csharp5', 'D5', 'Dsharp5', 'E5', 'F5', 'Fsharp5', 'G5', 'Gsharp5'
  ];
  var SAMPLE_FILE_SUFFIX = { A4: '-7-spn', Asharp4: '-7-spn' };   // default '-1-spn'
  var STRUM_STAGGER_MS = 32;

  var METRONOME_ACCENT_HZ = 1680;
  var METRONOME_BEAT_HZ = 1120;

  /** MIDI: guitar controllers report the string being played on this CC. */
  var MIDI_STRING_CONTROLLER = 30;

  var PLAY_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var PAUSE_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

  /* ========================================================================
   * 2. State
   * ===================================================================== */

  /**
   * @typedef {Object} Chord
   * @property {number}      id        Stable id (used to key the chord's paint canvas).
   * @property {number|null} root      Pitch class of the root, or null for an empty chord.
   * @property {number}      bars      Length in bars during playback (1–16).
   * @property {Array<Array<number>>} positions  Entered notes as [string, fret], in entry order.
   * @property {number[]}    excluded  Pitch classes dimmed and left out of transitions (↑ + click).
   */

  var state = {
    // First visit (nothing saved in this browser): a I–vi–ii–V in C.
    title: 'I VI II V in C',    // progression name (Session menu, PDF and file names)
    chords: [
      { id: 1, root: 0, bars: 1, positions: [[4, 3], [3, 2], [2, 0], [1, 0], [0, 0]], excluded: [] },           // C Maj7  x32000
      { id: 2, root: 9, bars: 1, positions: [[4, 0], [3, 2], [2, 0], [1, 1], [0, 0]], excluded: [] },           // A min7  x02010
      { id: 3, root: 2, bars: 1, positions: [[4, 5], [3, 3], [2, 5], [1, 5], [0, 5]], excluded: [] },           // D min9  x53555
      { id: 4, root: 7, bars: 1, positions: [[5, 3], [4, 2], [3, 0], [2, 0], [1, 0], [0, 1]], excluded: [] }    // G 7     320001
    ],
    activeIndex: 0,

    // Fretboard display
    fullMap: false,             // show every chord tone on the neck, not just the entered notes
    labelMode: 'intervals',     // 'intervals' | 'notes'
    colorByInterval: false,
    showNoteNames: true,        // faint note names on every fret (N key)

    // Playback
    playing: false,
    beat: -1,                   // beat within the current chord, -1 when stopped
    bpm: 100,
    metronomeOn: true,
    strumOn: true,
    volume: 0.5,
    transitionMs: 350,          // Motion slider: dot fades and manual chord transitions

    // Layout
    streamMode: false,          // hides nav and settings
    showProgression: true,      // B key

    // Add chord picker
    pickerOpen: false,
    pickerRoot: 9,              // A
    pickerQuality: 'min7',

    // Tuning and transpose
    transposeOffset: 0,         // running semitone offset shown next to Transpose
    tuningOffsets: [0, 0, 0, 0, 0, 0],   // semitones per string relative to standard tuning

    // Paint
    paintMode: false,
    brushColorIndex: 0,
    brushWidth: 'thin',         // 'thin' | 'thick'
    eraserOn: false,

    // MIDI
    midiEnabled: false
  };

  var nextChordId = 5;
  var beatTimer = null;          // setInterval driving the metronome
  var transitionTimer = null;    // setTimeout that starts the half-beat transition into the next chord

  /** Shorthand for document.getElementById. */
  function byId(id) { return document.getElementById(id); }

  /** Merge `changes` into state and re-render. */
  function setState(changes) {
    for (var key in changes) state[key] = changes[key];
    render();
    emit('change');
  }

  /** Listeners for the small public API (window.Fretnoodle): `change` after
   *  every render, `stroke` while painting, `drawing` when a drawing is
   *  finished or cleared. */
  var listeners = { change: [], stroke: [], drawing: [] };

  function emit(type, detail) {
    listeners[type].forEach(function (listener) { listener(detail); });
  }

  /** The chord currently shown, with its (clamped) index. */
  function getActiveChord() {
    var index = Math.min(state.activeIndex, Math.max(0, state.chords.length - 1));
    return { index: index, chord: state.chords[index] || null };
  }

  /** @returns {Chord} */
  function createChord(root, positions) {
    return { id: nextChordId++, root: root, bars: 1, positions: positions || [], excluded: [] };
  }

  /* ========================================================================
   * 3. Music helpers
   * ===================================================================== */

  /** Pitch class of an open string in the current tuning. */
  function openStringPitchClass(string) {
    return ((STANDARD_PITCH_CLASSES[string] + state.tuningOffsets[string]) % 12 + 12) % 12;
  }

  /** MIDI note number of an open string in the current tuning. */
  function openStringMidi(string) {
    return STANDARD_MIDI_NOTES[string] + state.tuningOffsets[string];
  }

  /** Pitch class sounding at a string/fret. */
  function pitchClassAt(string, fret) {
    return (openStringPitchClass(string) + fret) % 12;
  }

  function findPickerQuality(id) {
    for (var i = 0; i < PICKER_QUALITIES.length; i++) {
      if (PICKER_QUALITIES[i].id === id) return PICKER_QUALITIES[i];
    }
    return PICKER_QUALITIES[0];
  }

  /** A picker quality's intervals in ascending order. */
  function sortedIntervals(qualityId) {
    return findPickerQuality(qualityId).intervals.slice().sort(function (a, b) { return a - b; });
  }

  /** Interval label, with the spellings some chords need (#5, bb7, 9). */
  function intervalLabel(semitones, qualityName) {
    if (qualityName === 'aug' && semitones === 8) return '#5';
    if (qualityName === 'dim7' && semitones === 9) return 'bb7';
    if ((qualityName === '9' || qualityName === 'add9') && semitones === 2) return '9';
    return INTERVAL_LABELS[semitones];
  }

  /** Dot colour for an interval (accent for everything when colour coding is off). */
  function intervalColor(semitones) {
    if (!state.colorByInterval || semitones === 0) return INTERVAL_COLORS.root;
    if (semitones === 3 || semitones === 4) return INTERVAL_COLORS.thirds;
    if (semitones >= 6 && semitones <= 8) return INTERVAL_COLORS.fifths;
    if (semitones >= 9) return INTERVAL_COLORS.sixthsSevenths;
    return INTERVAL_COLORS.other;
  }

  /**
   * Interval formula ("0,3,7,10") → quality name. Picker qualities are added
   * first so they keep their names (e.g. "Maj" rather than "maj").
   */
  var qualityByFormula = {};
  PICKER_QUALITIES.forEach(function (quality) {
    qualityByFormula[sortedIntervals(quality.id).join(',')] = quality.id;
  });
  CHORD_DATABASE.forEach(function (entry) {
    var formula = entry.slice(0, -1).join(',');
    if (!qualityByFormula[formula]) qualityByFormula[formula] = entry[entry.length - 1];
  });

  /** Unique pitch classes of a chord's entered notes, in entry order. */
  function enteredPitchClasses(chord) {
    var pitchClasses = [];
    (chord.positions || []).forEach(function (position) {
      var pitchClass = pitchClassAt(position[0], position[1]);
      if (pitchClasses.indexOf(pitchClass) < 0) pitchClasses.push(pitchClass);
    });
    return pitchClasses;
  }

  /**
   * Work out a chord's root, intervals and name from its entered notes.
   * Unrecognised note sets are named by listing their notes, as before.
   *
   * @returns {null|{root:number, intervals:number[], quality:string|null, qualityText:string}}
   */
  function analyzeChord(chord) {
    if (!chord) return null;
    var pitchClasses = enteredPitchClasses(chord);
    if (!pitchClasses.length) return null;

    var root = pitchClasses.indexOf(chord.root) >= 0 ? chord.root : pitchClasses[0];
    var intervals = pitchClasses
      .map(function (pitchClass) { return (pitchClass - root + 12) % 12; })
      .sort(function (a, b) { return a - b; });
    var quality = qualityByFormula[intervals.join(',')] || null;
    var qualityText = quality || intervals.slice(1).map(function (interval) {
      return NOTE_NAMES[(root + interval) % 12];
    }).join(' ');

    return { root: root, intervals: intervals, quality: quality, qualityText: qualityText };
  }

  /**
   * Playable shape for a picked chord: a four-fret window starting at the
   * root's fret on the low string. Each string, low to high, takes the first
   * chord tone in the window, preferring one not used yet. Any tone still
   * missing is added so the chord is recognised correctly on the board.
   */
  function buildVoicing(root, intervals) {
    var windowStart = (root - openStringPitchClass(5) + 12) % 12;
    var chordTones = intervals.map(function (interval) { return (root + interval) % 12; });
    var used = {};
    var positions = [];

    for (var string = STRING_COUNT - 1; string >= 0; string--) {
      var chosenFret = -1;
      for (var fret = windowStart; fret <= windowStart + 3; fret++) {
        var pitchClass = pitchClassAt(string, fret);
        if (chordTones.indexOf(pitchClass) < 0) continue;
        if (!used[pitchClass]) { chosenFret = fret; break; }
        if (chosenFret < 0) chosenFret = fret;
      }
      if (chosenFret >= 0) {
        positions.push([string, chosenFret]);
        used[pitchClassAt(string, chosenFret)] = true;
      }
    }

    chordTones.forEach(function (tone) {
      if (used[tone]) return;
      for (var fret = windowStart; fret <= windowStart + 4; fret++) {
        for (var string = STRING_COUNT - 1; string >= 0; string--) {
          if (pitchClassAt(string, fret) === tone) {
            positions.push([string, fret]);
            used[tone] = true;
            return;
          }
        }
      }
    });
    return positions;
  }

  /**
   * Move every position by `semitones` frets. If the shape falls off the
   * bottom of the neck it moves up an octave; if it runs past fret 18 and is
   * already high up it moves down an octave.
   */
  function shiftPositions(positions, semitones) {
    var shifted = positions.map(function (position) { return [position[0], position[1] + semitones]; });
    if (!shifted.length) return shifted;

    var frets = shifted.map(function (position) { return position[1]; });
    var lowest = Math.min.apply(null, frets);
    var highest = Math.max.apply(null, frets);
    if (lowest < 0) {
      shifted = shifted.map(function (position) { return [position[0], position[1] + 12]; });
    } else if (highest > FRET_COUNT && lowest >= 12) {
      shifted = shifted.map(function (position) { return [position[0], position[1] - 12]; });
    }
    return shifted.filter(function (position) { return position[1] >= 0 && position[1] <= FRET_COUNT; });
  }

  /** Remove duplicate [string, fret] entries, keeping the first. */
  function uniquePositions(positions) {
    var seen = {};
    return positions.filter(function (position) {
      var key = position[0] + '-' + position[1];
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function formatBars(count) { return count + (count === 1 ? ' bar' : ' bars'); }

  function escapeHtml(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  /** A STRING_COUNT × (FRET_COUNT + 1) grid; `initial` may be a factory function. */
  function createGrid(initial) {
    var grid = [];
    for (var string = 0; string < STRING_COUNT; string++) {
      grid.push([]);
      for (var fret = 0; fret <= FRET_COUNT; fret++) {
        grid[string].push(typeof initial === 'function' ? initial() : initial);
      }
    }
    return grid;
  }

  /* ========================================================================
   * 4. Sound
   * ===================================================================== */

  var audioContext = null;

  /** Lazily create (and resume) the Web Audio context used for the metronome. */
  function getAudioContext() {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
    } catch (error) { /* audio unavailable */ }
    return audioContext;
  }

  /** Short sine click: higher pitch on the first beat of a bar. */
  function playMetronomeClick(isAccent) {
    var context = getAudioContext();
    if (!context) return;
    try {
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      oscillator.frequency.value = isAccent ? METRONOME_ACCENT_HZ : METRONOME_BEAT_HZ;
      gain.gain.setValueAtTime(Math.max(0.0001, state.volume * 0.5), context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.05);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.06);
    } catch (error) { /* ignore */ }
  }

  // Map MIDI note number → sample URL. <audio> elements are used rather than
  // fetch + Web Audio so playback also works from file://.
  var NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var sampleUrlByMidi = {};
  SAMPLE_NAMES.forEach(function (name) {
    var match = /^([A-G])(sharp)?(\d)$/.exec(name);
    var midi = (Number(match[3]) + 1) * 12 + NOTE_OFFSETS[match[1]] + (match[2] ? 1 : 0);
    sampleUrlByMidi[midi] = SAMPLE_FOLDER + name + (SAMPLE_FILE_SUFFIX[name] || '-1-spn') + '.wav';
  });
  var sampleMidiNotes = Object.keys(sampleUrlByMidi).map(Number);
  var preloadedSamples = {};   // url → <audio>
  var ringingNotes = [];       // string → <audio> currently sounding on it

  function preloadSamples() {
    sampleMidiNotes.forEach(function (midi) {
      var audio = new Audio();
      audio.preload = 'auto';
      audio.src = sampleUrlByMidi[midi];
      preloadedSamples[sampleUrlByMidi[midi]] = audio;
    });
  }

  /**
   * Play a guitar note. Uses the nearest sample, pitch-shifted if needed.
   * A new note on a string fades out the note already ringing there.
   */
  function playGuitarNote(midi, string, delayMs) {
    var nearest = sampleMidiNotes[0];
    sampleMidiNotes.forEach(function (candidate) {
      if (Math.abs(candidate - midi) < Math.abs(nearest - midi)) nearest = candidate;
    });
    var url = sampleUrlByMidi[nearest];
    var audio = preloadedSamples[url] ? preloadedSamples[url].cloneNode() : new Audio(url);
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
    audio.playbackRate = Math.pow(2, (midi - nearest) / 12);
    audio.volume = Math.min(1, state.volume * 1.4);

    setTimeout(function () {
      if (ringingNotes[string]) fadeOut(ringingNotes[string]);
      ringingNotes[string] = audio;
      audio.play().catch(function () { /* blocked until the user interacts */ });
    }, delayMs || 0);
  }

  function fadeOut(audio) {
    var volume = audio.volume;
    var fade = setInterval(function () {
      volume -= 0.12;
      if (volume <= 0) { clearInterval(fade); audio.pause(); }
      else audio.volume = volume;
    }, 16);
  }

  /** Strum a chord's entered notes from the low string up, one note per string. */
  function strumChord(chord) {
    if (!chord || !chord.positions) return;
    var lowToHigh = chord.positions.slice().sort(function (a, b) { return b[0] - a[0]; });
    var stringsPlayed = {};
    lowToHigh.forEach(function (position, order) {
      var string = position[0], fret = position[1];
      if (stringsPlayed[string]) return;
      stringsPlayed[string] = true;
      playGuitarNote(openStringMidi(string) + fret, string, order * STRUM_STAGGER_MS);
      pulseDot(string, fret, order * STRUM_STAGGER_MS);
    });
  }

  /* ========================================================================
   * 5. Fretboard DOM
   * ===================================================================== */

  var fretboardEl = byId('fretboard');
  var fretColumns = [];   // column element per fret
  var noteDots = createGrid(null);
  var noteNameLabels = createGrid(null);
  var midiRings = createGrid(null);

  /** Build the 19 fret columns (and fret numbers) once. */
  function buildFretboard() {
    var fretNumbersEl = byId('fretNumbers');
    for (var fret = 0; fret <= FRET_COUNT; fret++) {
      var flex = fret === 0
        ? OPEN_STRING_COLUMN_WIDTH
        : (100 * Math.pow(FRET_WIDTH_RATIO, fret - 1)).toFixed(2) + ' 1 0px';

      var column = document.createElement('div');
      column.className = 'fret-column';
      column.style.flex = flex;

      var html = '';
      if (INLAY_FRETS[fret]) html += '<div class="fret-inlay" aria-hidden="true"></div>';
      if (fret > 0) html += '<div class="fret-wire' + (fret === 1 ? ' is-nut' : '') + '" aria-hidden="true"></div>';
      for (var string = 0; string < STRING_COUNT; string++) {
        html += '<button type="button" class="fret-cell" data-string="' + string + '" data-fret="' + fret + '">' +
          '<span class="note-name" aria-hidden="true"></span>' +
          '<span class="note-dot"></span>' +
          '<span class="midi-ring" aria-hidden="true"></span>' +
          '</button>';
      }
      column.innerHTML = html;
      fretboardEl.appendChild(column);
      fretColumns.push(column);

      for (string = 0; string < STRING_COUNT; string++) {
        var cell = column.querySelector('[data-string="' + string + '"]');
        noteDots[string][fret] = cell.querySelector('.note-dot');
        noteNameLabels[string][fret] = cell.querySelector('.note-name');
        midiRings[string][fret] = cell.querySelector('.midi-ring');
      }

      var number = document.createElement('div');
      number.style.flex = flex;
      number.textContent = fret;
      fretNumbersEl.appendChild(number);
    }
  }

  /** Brief brightness pulse on a dot (when its note sounds). */
  function pulseDot(string, fret, delayMs) {
    setTimeout(function () {
      var dot = noteDots[string][fret];
      dot.classList.remove('is-pulsing');
      void dot.offsetWidth;   // restart the animation
      dot.classList.add('is-pulsing');
    }, delayMs || 0);
  }

  /* ========================================================================
   * 6. Chord transitions
   *
   * Port of the original visualiser's mapmode_funct() and transition().
   * For two consecutive chords A → B, every mapped note of A either:
   *   - stays put, if B has a note at the same string/fret (common);
   *   - slides along its string to a note of B, trying fret +1, −1, +2, −2 in
   *     that priority order and skipping B's common notes;
   *   - or collapses, if there is nowhere to go.
   * B's notes that nothing slid into arise. Notes excluded with ↑ + click (in
   * either chord) take no part. Going backwards uses the same pair in reverse:
   * slides run from B back to their origins, and arise/collapse swap.
   *
   * Transitions only run with Full map on. While one runs, the real dots are
   * hidden and plain dots are drawn on the transition layer each frame.
   * ===================================================================== */

  /** Which cells a chord occupies on the full map, and which are excluded. */
  function chordOccupancy(chord) {
    var pitchClasses = enteredPitchClasses(chord);
    var excluded = chord.excluded || [];
    var present = createGrid(false);
    var isExcluded = createGrid(false);
    for (var string = 0; string < STRING_COUNT; string++) {
      for (var fret = 0; fret <= FRET_COUNT; fret++) {
        var pitchClass = pitchClassAt(string, fret);
        present[string][fret] = pitchClasses.indexOf(pitchClass) >= 0;
        isExcluded[string][fret] = excluded.indexOf(pitchClass) >= 0;
      }
    }
    return { present: present, excluded: isExcluded };
  }

  /**
   * Compute how every note moves from chord A to chord B.
   *
   * @returns {{common: boolean[][], slideTo: number[][], slideFrom: number[][][],
   *            collapse: boolean[][], arise: boolean[][]}}
   *   common    – cell shared by both chords (A's and B's flags are identical)
   *   slideTo   – for A's cells: destination fret on the same string, or -1
   *   slideFrom – for B's cells: the A frets that slide into it
   *   collapse  – A's cells that shrink away
   *   arise     – B's cells that grow in
   */
  function computeTransition(chordA, chordB) {
    var a = chordOccupancy(chordA);
    var b = chordOccupancy(chordB);
    var plan = {
      common: createGrid(false),
      slideTo: createGrid(-1),
      slideFrom: createGrid(function () { return []; }),
      collapse: createGrid(false),
      arise: createGrid(false)
    };
    var string, fret;

    // Pass 1: notes common to both chords stay put.
    for (string = 0; string < STRING_COUNT; string++) {
      for (fret = 0; fret <= FRET_COUNT; fret++) {
        if (a.present[string][fret] && b.present[string][fret] &&
            !a.excluded[string][fret] && !b.excluded[string][fret]) {
          plan.common[string][fret] = true;
        }
      }
    }

    // Pass 2: every other note of A slides to the nearest free note of B on
    // the same string (+1, −1, +2, −2 frets, in that priority), or collapses.
    var OFFSET_PRIORITY = [1, -1, 2, -2];
    for (string = 0; string < STRING_COUNT; string++) {
      for (fret = 0; fret <= FRET_COUNT; fret++) {
        if (!a.present[string][fret] || plan.common[string][fret] || a.excluded[string][fret]) continue;

        var destination = -1;
        for (var p = 0; p < OFFSET_PRIORITY.length && destination < 0; p++) {
          var target = fret + OFFSET_PRIORITY[p];
          if (target < 0 || target > FRET_COUNT) continue;
          if (b.present[string][target] && !b.excluded[string][target] && !plan.common[string][target]) {
            destination = target;
          }
        }

        if (destination >= 0) {
          plan.slideTo[string][fret] = destination;
          plan.slideFrom[string][destination].push(fret);
        } else {
          plan.collapse[string][fret] = true;
        }
      }
    }

    // Pass 3: B's notes that nothing slid into arise.
    for (string = 0; string < STRING_COUNT; string++) {
      for (fret = 0; fret <= FRET_COUNT; fret++) {
        if (b.present[string][fret] && !plan.slideFrom[string][fret].length && !b.excluded[string][fret]) {
          plan.arise[string][fret] = true;
        }
      }
    }
    return plan;
  }

  var transitionLayer = byId('transitionLayer');
  var transitionDots = [];       // reusable pool of transition-layer dots
  var activeTransition = null;   // { plan, direction, startTime, durationMs, columnCenters, fallbackTimer }

  /**
   * Animate from one chord to another.
   * @param {number} direction  1 = forward (A→B), -1 = backward, 0 = jump (no animation)
   */
  function startTransition(fromIndex, toIndex, direction, durationMs) {
    endTransition();
    if (!state.fullMap || !direction || durationMs <= 0) return;
    var fromChord = state.chords[fromIndex];
    var toChord = state.chords[toIndex];
    if (!fromChord || !toChord) return;

    activeTransition = {
      plan: direction === 1 ? computeTransition(fromChord, toChord) : computeTransition(toChord, fromChord),
      direction: direction,
      startTime: performance.now(),
      durationMs: durationMs,
      columnCenters: fretColumns.map(function (column) { return column.offsetLeft + column.offsetWidth / 2; }),
      // requestAnimationFrame stalls in background tabs; never leave the board mid-transition
      fallbackTimer: setTimeout(endTransition, durationMs + 50)
    };
    fretboardEl.classList.add('is-transitioning');
    requestAnimationFrame(drawTransitionFrame);
  }

  /** Stop any running transition and show the real dots without re-fading them. */
  function endTransition() {
    if (!activeTransition) return;
    clearTimeout(activeTransition.fallbackTimer);
    activeTransition = null;
    transitionDots.forEach(function (dot) { dot.style.display = 'none'; });
    fretboardEl.classList.add('is-snapping');
    fretboardEl.classList.remove('is-transitioning');
    void fretboardEl.offsetWidth;   // apply the snap before re-enabling transitions
    fretboardEl.classList.remove('is-snapping');
  }

  /** Draw one animation frame. Movement is linear, as in the original. */
  function drawTransitionFrame(now) {
    var transition = activeTransition;
    if (!transition) return;

    var progress = Math.min(1, (now - transition.startTime) / transition.durationMs);
    var plan = transition.plan;
    var centers = transition.columnCenters;
    var dotsToDraw = [];   // [x, y, scale]

    function addDot(string, x, scale) {
      dotsToDraw.push([x, FIRST_STRING_CENTER + STRING_ROW_HEIGHT * string, scale]);
    }
    function slideX(fromFret, toFret) {
      return centers[fromFret] + (centers[toFret] - centers[fromFret]) * progress;
    }

    for (var string = 0; string < STRING_COUNT; string++) {
      for (var fret = 0; fret <= FRET_COUNT; fret++) {
        if (plan.common[string][fret]) { addDot(string, centers[fret], 1); continue; }

        if (transition.direction === 1) {
          if (plan.arise[string][fret]) { addDot(string, centers[fret], progress); continue; }
          if (plan.collapse[string][fret]) addDot(string, centers[fret], 1 - progress);
          if (plan.slideTo[string][fret] >= 0) addDot(string, slideX(fret, plan.slideTo[string][fret]), 1);
        } else {
          // Backward: A's collapsing notes grow back, B's arising notes shrink,
          // and each slide runs from B's note back to its origin(s).
          if (plan.collapse[string][fret]) { addDot(string, centers[fret], progress); continue; }
          if (plan.arise[string][fret]) addDot(string, centers[fret], 1 - progress);
          plan.slideFrom[string][fret].forEach(function (originFret) {
            addDot(string, slideX(fret, originFret), 1);
          });
        }
      }
    }

    while (transitionDots.length < dotsToDraw.length) {
      var dot = document.createElement('div');
      dot.className = 'transition-dot';
      transitionLayer.appendChild(dot);
      transitionDots.push(dot);
    }
    transitionDots.forEach(function (dotEl, i) {
      var item = dotsToDraw[i];
      if (!item || item[2] <= 0) { dotEl.style.display = 'none'; return; }
      dotEl.style.display = 'block';
      dotEl.style.left = item[0] + 'px';
      dotEl.style.top = item[1] + 'px';
      dotEl.style.transform = 'scale(' + item[2] + ')';
    });

    if (progress >= 1) endTransition();
    else requestAnimationFrame(drawTransitionFrame);
  }

  /* ========================================================================
   * 7. Paint
   *
   * Each chord has its own transparent canvas over the fretboard, shown only
   * in paint mode. Holding shift while drawing draws on every chord's canvas.
   *
   * Drawings are also kept as strokes (brush, eraser and the points the
   * pointer passed through) so they can be saved compactly and redrawn
   * exactly, e.g. from a share link. The canvas is only the display.
   * ===================================================================== */

  /**
   * @typedef {Object} Stroke
   * @property {number}   color   index into BRUSH_COLORS
   * @property {string}   width   'thin' | 'thick'
   * @property {boolean}  eraser
   * @property {number[]} points  x0, y0, x1, y1 … in canvas units, rounded
   */

  var fretboardFrame = byId('fretboardFrame');
  var paintLayer = byId('paintLayer');
  var chordCanvases = {};     // chord id → <canvas>
  var chordStrokes = {};      // chord id → Stroke[]
  var canvasSize = null;      // logical size, fixed when the first canvas is made
  var lastPaintPoint = null;  // previous pointer position while drawing
  var gestureStrokes = {};    // chord id → { stroke, last } for the current pointer gesture

  function getChordCanvas(chord) {
    if (chordCanvases[chord.id]) return chordCanvases[chord.id];
    if (!canvasSize) canvasSize = { width: fretboardFrame.offsetWidth, height: fretboardFrame.offsetHeight };

    var pixelRatio = window.devicePixelRatio || 1;
    var canvas = document.createElement('canvas');
    canvas.width = canvasSize.width * pixelRatio;
    canvas.height = canvasSize.height * pixelRatio;
    canvas.getContext('2d').scale(pixelRatio, pixelRatio);
    canvas.hidden = true;
    paintLayer.appendChild(canvas);
    chordCanvases[chord.id] = canvas;
    return canvas;
  }

  function removeChordCanvas(chordId) {
    delete chordStrokes[chordId];
    if (!chordCanvases[chordId]) return;
    chordCanvases[chordId].remove();
    delete chordCanvases[chordId];
  }

  /** Show only the active chord's canvas. */
  function showActiveCanvas() {
    var chord = getActiveChord().chord;
    Object.keys(chordCanvases).forEach(function (id) {
      chordCanvases[id].hidden = !chord || Number(id) !== chord.id;
    });
    if (chord && state.paintMode) getChordCanvas(chord).hidden = false;
  }

  function pointerToCanvas(event) {
    var rect = paintLayer.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvasSize.width / rect.width,
      y: (event.clientY - rect.top) * canvasSize.height / rect.height
    };
  }

  /** Draw one segment of a stroke. The eraser clears a square at `to`, as before. */
  function drawSegment(canvas, stroke, from, to) {
    var context = canvas.getContext('2d');
    if (stroke.eraser) {
      context.save();
      context.globalCompositeOperation = 'destination-out';
      context.fillRect(to.x - ERASER_SIZE / 2, to.y - ERASER_SIZE / 2, ERASER_SIZE, ERASER_SIZE);
      context.restore();
    } else {
      context.strokeStyle = BRUSH_COLORS[stroke.color];
      context.lineWidth = BRUSH_WIDTHS[stroke.width];
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
  }

  /** Clear a chord's canvas and draw its strokes again. */
  function redrawChord(chord) {
    var canvas = getChordCanvas(chord);
    canvas.getContext('2d').clearRect(0, 0, canvasSize.width, canvasSize.height);
    (chordStrokes[chord.id] || []).forEach(function (stroke) {
      var p = stroke.points;
      for (var i = 2; i + 1 < p.length; i += 2) {
        drawSegment(canvas, stroke, { x: p[i - 2], y: p[i - 1] }, { x: p[i], y: p[i + 1] });
      }
    });
  }

  /** Add a segment to the chord's stroke for this gesture (starting a new
   *  stroke if shift was let go and pressed again in between). */
  function recordSegment(chord, from, to) {
    var entry = gestureStrokes[chord.id];
    if (!entry || entry.last !== from) {
      var stroke = {
        color: state.brushColorIndex, width: state.brushWidth, eraser: state.eraserOn,
        points: [Math.round(from.x), Math.round(from.y)]
      };
      (chordStrokes[chord.id] = chordStrokes[chord.id] || []).push(stroke);
      entry = gestureStrokes[chord.id] = { stroke: stroke };
    }
    // Draw with the rounded points that are saved, so a replay matches exactly.
    var p = entry.stroke.points;
    p.push(Math.round(to.x), Math.round(to.y));
    entry.last = to;
    drawSegment(getChordCanvas(chord), entry.stroke,
      { x: p[p.length - 4], y: p[p.length - 3] }, { x: p[p.length - 2], y: p[p.length - 1] });
  }

  function bindPaintEvents() {
    paintLayer.addEventListener('pointerdown', function (event) {
      if (!getActiveChord().chord) return;
      paintLayer.setPointerCapture(event.pointerId);
      lastPaintPoint = pointerToCanvas(event);
      gestureStrokes = {};
    });
    paintLayer.addEventListener('pointermove', function (event) {
      if (!lastPaintPoint) return;
      var point = pointerToCanvas(event);
      var targets = event.shiftKey ? state.chords : [getActiveChord().chord];
      var from = lastPaintPoint;
      targets.forEach(function (chord) { recordSegment(chord, from, point); });
      lastPaintPoint = point;
      emit('stroke', { allChords: event.shiftKey });
    });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      paintLayer.addEventListener(type, function () {
        lastPaintPoint = null;
        if (Object.keys(gestureStrokes).length) emit('drawing');
        gestureStrokes = {};
      });
    });
  }

  /* ========================================================================
   * 8. MIDI input
   *
   * Port of the original WebMidi listeners, using the browser's Web MIDI API.
   * A note-on marks every cell with that pitch; when the guitar then reports
   * the string on CC#30, the matching cell lights up with a cyan ring until
   * note-off. (A note without string information shows nothing, as before.)
   * ===================================================================== */

  var midiNoteHeld = createGrid(false);   // note-on received, string not known yet
  var midiNoteShown = createGrid(false);  // string confirmed: ring is lit
  var midiAccess = null;

  function setMidiStatus(text) {
    var el = byId('midiStatus');
    el.hidden = !text;
    el.textContent = text || '';
  }

  /** (Re)attach the message handler to every MIDI input and report status. */
  function attachMidiInputs() {
    if (!midiAccess) return;
    var deviceNames = [];
    midiAccess.inputs.forEach(function (input) {
      input.onmidimessage = state.midiEnabled ? handleMidiMessage : null;
      deviceNames.push(input.name);
    });
    if (state.midiEnabled) {
      setMidiStatus(deviceNames.length
        ? 'Listening to ' + deviceNames.join(', ')
        : 'No MIDI devices found. Plug one in.');
    }
  }

  function requestMidi() {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('This browser has no Web MIDI. Try Chrome or Edge.');
      return;
    }
    if (midiAccess) { attachMidiInputs(); return; }
    setMidiStatus('Waiting for MIDI permission…');
    navigator.requestMIDIAccess().then(function (access) {
      midiAccess = access;
      access.onstatechange = attachMidiInputs;
      attachMidiInputs();
    }, function () {
      setMidiStatus('MIDI access was blocked.');
      setState({ midiEnabled: false });
    });
  }

  /** String number from the CC#30 value (ranges as in the original). */
  function midiStringFromController(value) {
    if (value >= 0 && value <= 15) return 0;
    if (value > 16 && value <= 31) return 1;
    if (value > 32 && value <= 47) return 2;
    if (value > 48 && value <= 63) return 3;
    if (value > 64 && value <= 79) return 4;
    if (value > 80 && value <= 95) return 5;
    return -1;
  }

  function handleMidiMessage(event) {
    var data = event.data;
    var command = data[0] & 0xf0;
    var string, fret;

    if (command === 0x90 && data[2] > 0) {                                    // note on
      for (string = 0; string < STRING_COUNT; string++) {
        for (fret = 0; fret <= FRET_COUNT; fret++) {
          if (openStringMidi(string) + fret === data[1]) midiNoteHeld[string][fret] = true;
        }
      }
    } else if (command === 0x80 || (command === 0x90 && data[2] === 0)) {     // note off
      for (string = 0; string < STRING_COUNT; string++) {
        for (fret = 0; fret <= FRET_COUNT; fret++) {
          if (openStringMidi(string) + fret === data[1]) {
            midiNoteHeld[string][fret] = false;
            midiNoteShown[string][fret] = false;
          }
        }
      }
    } else if (command === 0xb0 && data[1] === MIDI_STRING_CONTROLLER) {      // string number
      var playedString = midiStringFromController(data[2]);
      for (string = 0; string < STRING_COUNT; string++) {
        for (fret = 0; fret <= FRET_COUNT; fret++) {
          if (midiNoteHeld[string][fret] && string === playedString) {
            midiNoteShown[string][fret] = true;
            midiNoteHeld = createGrid(false);
          }
        }
      }
    }
    renderMidiRings();
  }

  function resetMidiNotes() {
    midiNoteHeld = createGrid(false);
    midiNoteShown = createGrid(false);
    renderMidiRings();
  }

  function renderMidiRings() {
    for (var string = 0; string < STRING_COUNT; string++) {
      for (var fret = 0; fret <= FRET_COUNT; fret++) {
        midiRings[string][fret].classList.toggle('is-on', midiNoteShown[string][fret]);
      }
    }
  }

  /* ========================================================================
   * 9. Rendering
   * ===================================================================== */

  var lastCardSignature = '';   // chord cards are only rebuilt when this changes

  /** Update the whole page from `state`. */
  function render() {
    var active = getActiveChord();
    var chord = active.chord;
    var analysis = analyzeChord(chord);
    var excluded = chord ? chord.excluded || [] : [];

    document.documentElement.style.setProperty('--dot-transition', state.transitionMs + 'ms');
    if (!state.fullMap) endTransition();

    var tones = chordTones(analysis, excluded);

    renderLayout();
    renderHero(active, chord, analysis, tones);
    renderMapBar(analysis, tones);
    renderPaintControls();
    renderFretboard(chord, analysis, excluded);
    renderProgression(active, chord);
    renderChordPicker();
    renderSettings();
  }

  /** Chip data for each note of an analysed chord. */
  function chordTones(analysis, excluded) {
    return analysis ? analysis.intervals.map(function (interval) {
      var pitchClass = (analysis.root + interval) % 12;
      return {
        label: intervalLabel(interval, analysis.quality),
        note: NOTE_NAMES[pitchClass],
        color: intervalColor(interval),
        excluded: excluded.indexOf(pitchClass) >= 0
      };
    }) : [];
  }

  function renderLayout() {
    document.querySelectorAll('[data-chrome]').forEach(function (el) { el.hidden = state.streamMode; });
    var nameInput = byId('progressionName');
    if (document.activeElement !== nameInput) nameInput.value = state.title;
    document.title = (state.title ? state.title + ' — ' : '') + 'Fretnoodle — Fretboard visualiser';
    setPressed('[data-action=toggleStreamMode]', state.streamMode);
    byId('streamModeLabel').textContent = state.streamMode ? 'Exit stream mode' : 'Stream mode';
    byId('progression').hidden = !state.showProgression;
  }

  function renderHero(active, chord, analysis, tones) {
    byId('chordPosition').textContent = 'Chord ' +
      (chord ? (active.index + 1) + ' of ' + state.chords.length : '—') +
      ' · ' + formatBars(chord ? chord.bars : 1);

    byId('chordName').innerHTML = analysis
      ? escapeHtml(NOTE_NAMES[analysis.root]) + '<span class="chord-quality">' + escapeHtml(analysis.qualityText) + '</span>'
      : '—';

    byId('toneChips').innerHTML = tones.map(function (tone) {
      return '<div class="tone-chip' + (tone.excluded ? ' is-excluded' : '') + '">' +
        '<span class="tone-chip-interval" style="background:' + tone.color + '">' + escapeHtml(tone.label) + '</span>' +
        '<span class="tone-chip-note">' + tone.note + '</span></div>';
    }).join('');

    var playButton = byId('playButton');
    playButton.innerHTML = state.playing ? PAUSE_ICON : PLAY_ICON;
    playButton.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');

    var beatDots = byId('beatDots').children;
    for (var i = 0; i < beatDots.length; i++) {
      beatDots[i].classList.toggle('is-on', state.playing && state.beat >= 0 && state.beat % 4 === i);
    }
    byId('meterLabel').textContent = state.bpm + ' bpm · 4/4';
  }

  function renderMapBar(analysis, tones) {
    setChecked('[data-action=toggleFullMap]', state.fullMap);
    byId('mapLegendDot').classList.toggle('is-ringed', state.fullMap);
    byId('mapBarTitle').textContent = state.fullMap ? 'Every chord tone, everywhere on the neck' : 'Your shape';

    var caption;
    if (!analysis) {
      caption = 'Click any fret to enter a note · shift-click a note to make it the root';
    } else if (state.fullMap) {
      caption = 'All the ' + tones.map(function (tone) { return tone.note; }).join(', ') +
        ' notes up to fret 18 · your shape is ringed in white';
    } else {
      caption = 'Click frets to add or remove notes · shift-click to set the root · switch on Full map to see them all over the neck';
    }
    byId('mapBarCaption').textContent = caption;
  }

  function renderPaintControls() {
    setPressed('[data-action=togglePaintMode]', state.paintMode);
    byId('paintToolbar').hidden = !state.paintMode;
    paintLayer.hidden = !state.paintMode;
    document.querySelectorAll('[data-action=selectBrushColor]').forEach(function (el) {
      el.setAttribute('aria-pressed', Number(el.dataset.value) === state.brushColorIndex);
    });
    document.querySelectorAll('[data-action=selectBrushWidth]').forEach(function (el) {
      el.setAttribute('aria-pressed', el.dataset.value === state.brushWidth);
    });
    setChecked('[data-action=toggleEraser]', state.eraserOn);
    showActiveCanvas();
  }

  /**
   * Dots: a cell shows a dot if its pitch is in the chord AND (Full map is on
   * OR it is one of the entered notes). Entered notes are ringed in Full map.
   */
  function renderFretboard(chord, analysis, excluded) {
    fretboardEl.classList.toggle('hide-note-names', !state.showNoteNames);

    var intervalByPitchClass = [];
    for (var pc = 0; pc < 12; pc++) intervalByPitchClass.push(-1);
    if (analysis) {
      analysis.intervals.forEach(function (interval) {
        intervalByPitchClass[(analysis.root + interval) % 12] = interval;
      });
    }
    var entered = {};
    (chord ? chord.positions : []).forEach(function (position) { entered[position[0] + '-' + position[1]] = true; });

    for (var string = 0; string < STRING_COUNT; string++) {
      for (var fret = 0; fret <= FRET_COUNT; fret++) {
        var pitchClass = pitchClassAt(string, fret);
        var interval = intervalByPitchClass[pitchClass];
        var isChordTone = interval >= 0;
        var isEntered = !!entered[string + '-' + fret];
        var dot = noteDots[string][fret];

        noteNameLabels[string][fret].textContent = NOTE_NAMES[pitchClass];
        dot.classList.toggle('is-visible', isChordTone && (state.fullMap || isEntered));
        dot.classList.toggle('is-ringed', state.fullMap && isChordTone && isEntered);
        dot.classList.toggle('is-excluded', isChordTone && excluded.indexOf(pitchClass) >= 0);
        if (isChordTone) {
          dot.textContent = state.labelMode === 'notes' ? NOTE_NAMES[pitchClass] : intervalLabel(interval, analysis.quality);
          dot.style.background = intervalColor(interval);
        }
        dot.parentNode.setAttribute('aria-label', (isEntered ? 'Remove ' : 'Add ') + NOTE_NAMES[pitchClass] +
          ', string ' + (string + 1) + ', fret ' + fret);
      }
    }
  }

  function renderProgression(active, chord) {
    byId('barsValue').textContent = chord ? chord.bars : 1;
    byId('transposeValue').textContent = (state.transposeOffset > 0 ? '+' : '') + state.transposeOffset;

    var cardNames = state.chords.map(function (c) {
      var analysis = analyzeChord(c);
      return analysis
        ? escapeHtml(NOTE_NAMES[analysis.root]) + '<i>' + escapeHtml(analysis.qualityText) + '</i>'
        : '<i>Empty</i>';
    });

    // Rebuild cards only when names or lengths change, so the progress line can animate.
    var signature = state.chords.map(function (c, i) { return cardNames[i] + c.bars; }).join('|');
    var cardList = byId('chordCardList');
    if (signature !== lastCardSignature) {
      lastCardSignature = signature;
      cardList.innerHTML = state.chords.map(function (c, i) {
        return '<button type="button" class="chord-card" data-action="selectChord" data-index="' + i + '">' +
          '<span class="chord-card-name">' + cardNames[i] + '</span>' +
          '<span class="chord-card-meta">' + formatBars(c.bars) + '</span>' +
          '<span class="chord-card-progress" aria-hidden="true"></span></button>';
      }).join('');
    }

    Array.prototype.forEach.call(cardList.children, function (card, i) {
      var isActive = i === active.index;
      card.setAttribute('aria-current', isActive ? 'true' : 'false');
      var progress = isActive && state.playing && state.beat >= 0
        ? ((state.beat + 1) / (state.chords[i].bars * 4)) * 100
        : 0;
      card.lastChild.style.width = progress.toFixed(1) + '%';
    });
  }

  function renderChordPicker() {
    byId('addChordCard').setAttribute('aria-expanded', state.pickerOpen);
    byId('chordPicker').hidden = !state.pickerOpen;
    if (!state.pickerOpen) return;

    byId('pickerRootOptions').innerHTML = NOTE_NAMES.map(function (name, pitchClass) {
      return '<button type="button" class="picker-root" data-action="selectPickerRoot" data-value="' + pitchClass +
        '" aria-pressed="' + (state.pickerRoot === pitchClass) + '">' + name + '</button>';
    }).join('');

    byId('pickerQualityOptions').innerHTML = PICKER_QUALITIES.map(function (quality) {
      return '<button type="button" class="picker-quality" data-action="selectPickerQuality" data-value="' + quality.id +
        '" aria-pressed="' + (state.pickerQuality === quality.id) + '">' + escapeHtml(quality.id) + '</button>';
    }).join('');

    var previewNotes = sortedIntervals(state.pickerQuality).map(function (interval) {
      return NOTE_NAMES[(state.pickerRoot + interval) % 12];
    }).join(' · ');
    byId('pickerPreview').innerHTML = NOTE_NAMES[state.pickerRoot] +
      '<span class="picker-preview-quality">' + escapeHtml(state.pickerQuality) + '</span>' +
      '<span class="picker-preview-notes">' + previewNotes + '</span>';
  }

  function renderSettings() {
    document.querySelectorAll('[data-action=setLabelMode]').forEach(function (el) {
      el.setAttribute('aria-pressed', el.dataset.value === state.labelMode);
    });
    setChecked('[data-action=toggleColorByInterval]', state.colorByInterval);

    var legend = byId('intervalLegend');
    legend.hidden = !state.colorByInterval;
    legend.innerHTML = INTERVAL_LEGEND.map(function (item) {
      return '<span><i style="background:' + item.color + '"></i>' + escapeHtml(item.label) + '</span>';
    }).join('');

    setChecked('[data-action=toggleMetronome]', state.metronomeOn);
    setChecked('[data-action=toggleStrum]', state.strumOn);
    setChecked('[data-action=toggleMidi]', state.midiEnabled);

    byId('tempoValue').textContent = state.bpm;
    byId('volumeValue').textContent = Math.round(state.volume * 100) + '%';
    byId('transitionValue').textContent = state.transitionMs;
    syncSlider('tempoSlider', state.bpm);
    syncSlider('volumeSlider', state.volume);
    syncSlider('transitionSlider', state.transitionMs);

    byId('tuningGrid').innerHTML = [0, 1, 2, 3, 4, 5].map(function (string) {
      var number = string + 1;
      return '<div class="tuning-row"><span class="tuning-string-number">' + number + '</span>' +
        '<button type="button" class="btn-step" data-action="tuneString" data-string="' + string + '" data-semitones="-1"' +
        ' aria-label="Tune string ' + number + ' down a semitone">−</button>' +
        '<span class="stepper-value">' + NOTE_NAMES[openStringPitchClass(string)] + '</span>' +
        '<button type="button" class="btn-step" data-action="tuneString" data-string="' + string + '" data-semitones="1"' +
        ' aria-label="Tune string ' + number + ' up a semitone">+</button></div>';
    }).join('');
  }

  function setPressed(selector, value) { document.querySelector(selector).setAttribute('aria-pressed', value); }
  function setChecked(selector, value) { document.querySelector(selector).setAttribute('aria-checked', value); }

  /** Update a slider's value unless the user is dragging it. */
  function syncSlider(id, value) {
    var slider = byId(id);
    if (document.activeElement !== slider) slider.value = value;
  }

  /* ========================================================================
   * 10. Playback and navigation
   * ===================================================================== */

  function startBeatTimer() {
    clearInterval(beatTimer);
    beatTimer = setInterval(onBeat, 60000 / state.bpm);
  }

  function stopPlaybackTimers() {
    clearInterval(beatTimer);
    clearTimeout(transitionTimer);
  }

  /**
   * One metronome beat. As in the original, on the last beat of a chord the
   * transition into the next chord starts half a beat later and lasts half a
   * beat, so it lands exactly on the next downbeat.
   */
  function onBeat() {
    var beat = state.beat + 1;
    var chord = getActiveChord().chord;

    if (chord && beat >= chord.bars * 4) {   // safety net, e.g. bars reduced mid-chord
      goToChord((getActiveChord().index + 1) % state.chords.length, 1, 0);
      beat = 0;
    }
    setState({ beat: beat });
    if (state.metronomeOn) playMetronomeClick(beat % 4 === 0);
    if (state.strumOn && beat % 4 === 0) strumChord(getActiveChord().chord);

    chord = getActiveChord().chord;
    if (chord && beat === chord.bars * 4 - 1) {
      var halfBeatMs = 30000 / state.bpm;
      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(function () {
        if (!state.playing || !state.chords.length) return;
        goToChord((getActiveChord().index + 1) % state.chords.length, 1, halfBeatMs);
      }, halfBeatMs);
    }
  }

  /**
   * Show chord `index`.
   * @param {number} direction   1 forward, -1 backward, 0 jump (no transition)
   * @param {number} [durationMs] transition length; defaults to the Motion slider
   */
  function goToChord(index, direction, durationMs) {
    if (!state.chords.length) return;
    var fromIndex = getActiveChord().index;
    clearTimeout(transitionTimer);
    setState({ activeIndex: index, beat: state.playing ? -1 : state.beat });
    startTransition(fromIndex, index, direction, durationMs === undefined ? state.transitionMs : durationMs);
    if (state.strumOn && !state.playing) strumChord(state.chords[index]);
  }

  /** Previous (-1) or next (+1) chord, wrapping around. */
  function stepChord(direction) {
    var count = state.chords.length;
    if (count) goToChord((getActiveChord().index + direction + count) % count, direction);
  }

  function togglePlayback() {
    if (state.playing) {
      stopPlaybackTimers();
      setState({ playing: false, beat: -1 });
    } else if (state.chords.length) {
      setState({ playing: true, beat: 0 });
      if (state.metronomeOn) playMetronomeClick(true);
      if (state.strumOn) strumChord(getActiveChord().chord);
      startBeatTimer();
    }
  }

  /* ========================================================================
   * 11. Editing
   * ===================================================================== */

  /** Apply `update` to a copy of the active chord and store it. */
  function updateActiveChord(update) {
    var index = getActiveChord().index;
    setState({
      chords: state.chords.map(function (chord, i) {
        return i === index ? update(Object.assign({}, chord)) : chord;
      })
    });
  }

  /**
   * Fretboard click, as in the original app:
   *   click          add the note, or remove it if already entered
   *                  (the first note entered becomes the root)
   *   shift + click  make this note the root (adding it if needed)
   *   ↑ + click      dim this note everywhere in the chord and leave it out
   *                  of transitions; click again to restore
   */
  function handleFretClick(string, fret, makeRoot, toggleExcluded) {
    var pitchClass = pitchClassAt(string, fret);
    var noteAdded = false;
    if (!state.chords.length) setState({ chords: [createChord(null)], activeIndex: 0 });

    if (toggleExcluded) {
      if (enteredPitchClasses(getActiveChord().chord).indexOf(pitchClass) < 0) return;
      updateActiveChord(function (chord) {
        var excluded = (chord.excluded || []).slice();
        var at = excluded.indexOf(pitchClass);
        if (at >= 0) excluded.splice(at, 1); else excluded.push(pitchClass);
        chord.excluded = excluded;
        return chord;
      });
      return;
    }

    updateActiveChord(function (chord) {
      var existingIndex = -1;
      chord.positions.forEach(function (position, i) {
        if (position[0] === string && position[1] === fret) existingIndex = i;
      });

      if (makeRoot) {
        if (existingIndex < 0) { chord.positions = chord.positions.concat([[string, fret]]); noteAdded = true; }
        chord.root = pitchClass;
      } else if (existingIndex >= 0) {
        chord.positions = chord.positions.filter(function (position, i) { return i !== existingIndex; });
        var remaining = enteredPitchClasses(chord);
        if (remaining.indexOf(chord.root) < 0) chord.root = remaining.length ? remaining[0] : null;
      } else {
        chord.positions = chord.positions.concat([[string, fret]]);
        if (chord.root === null || chord.root === undefined || enteredPitchClasses(chord).length === 1) chord.root = pitchClass;
        noteAdded = true;
      }
      return chord;
    });

    if (noteAdded || makeRoot) {
      playGuitarNote(openStringMidi(string) + fret, string, 0);
      pulseDot(string, fret, 0);
    }
  }

  /** Transpose every chord (root, notes and exclusions) by a semitone. */
  function transposeAll(semitones) {
    setState({
      transposeOffset: state.transposeOffset + semitones,
      chords: state.chords.map(function (chord) {
        return Object.assign({}, chord, {
          root: chord.root === null ? null : (chord.root + semitones + 12) % 12,
          positions: shiftPositions(chord.positions || [], semitones),
          excluded: (chord.excluded || []).map(function (pc) { return (pc + semitones + 12) % 12; })
        });
      }),
      pickerRoot: (state.pickerRoot + semitones + 12) % 12
    });
    if (state.strumOn) strumChord(getActiveChord().chord);
  }

  /**
   * Retune one string by `semitones` (kept within an octave either way).
   * Entered notes on that string move frets so they keep the same pitch,
   * wrapping by an octave if they would fall off the neck.
   */
  function retuneString(string, semitones) {
    var tuningOffsets = state.tuningOffsets.slice();
    tuningOffsets[string] = Math.max(-12, Math.min(12, tuningOffsets[string] + semitones));
    var change = tuningOffsets[string] - state.tuningOffsets[string];
    if (!change) return;

    endTransition();
    resetMidiNotes();
    setState({
      tuningOffsets: tuningOffsets,
      chords: state.chords.map(function (chord) {
        return Object.assign({}, chord, {
          positions: uniquePositions(chord.positions.map(function (position) {
            if (position[0] !== string) return position;
            var fret = position[1] - change;
            if (fret < 0) fret += 12;
            else if (fret > FRET_COUNT) fret -= 12;
            return [position[0], fret];
          }))
        });
      })
    });
    playGuitarNote(openStringMidi(string), string, 0);
  }

  /* ========================================================================
   * 12. Actions and event wiring
   * ===================================================================== */

  /** Handlers for data-action buttons. Each receives the clicked element. */
  var actions = {
    // Header and transport
    toggleStreamMode: function () { setState({ streamMode: !state.streamMode }); },
    previousChord: function () { stepChord(-1); },
    nextChord: function () { stepChord(1); },
    togglePlayback: togglePlayback,

    // Fretboard display
    toggleFullMap: function () { setState({ fullMap: !state.fullMap }); },
    setLabelMode: function (el) { setState({ labelMode: el.dataset.value }); },
    toggleColorByInterval: function () { setState({ colorByInterval: !state.colorByInterval }); },

    // Paint
    togglePaintMode: function () { setState({ paintMode: !state.paintMode }); },
    selectBrushColor: function (el) { setState({ brushColorIndex: Number(el.dataset.value), eraserOn: false }); },
    selectBrushWidth: function (el) { setState({ brushWidth: el.dataset.value, eraserOn: false }); },
    toggleEraser: function () { setState({ eraserOn: !state.eraserOn }); },
    clearDrawing: function () {
      var chord = getActiveChord().chord;
      if (!chord) return;
      chordStrokes[chord.id] = [];
      redrawChord(chord);
      emit('drawing');
    },

    // Progression
    selectChord: function (el) {
      var index = Number(el.dataset.index);
      var current = getActiveChord().index;
      var count = state.chords.length;
      var direction = index === (current + 1) % count ? 1 : index === (current - 1 + count) % count ? -1 : 0;
      goToChord(index, direction);
    },
    decreaseBars: function () {
      if (getActiveChord().chord) updateActiveChord(function (chord) { chord.bars = Math.max(1, chord.bars - 1); return chord; });
    },
    increaseBars: function () {
      if (getActiveChord().chord) updateActiveChord(function (chord) { chord.bars = Math.min(16, chord.bars + 1); return chord; });
    },
    transposeDown: function () { transposeAll(-1); },
    transposeUp: function () { transposeAll(1); },
    removeChord: function () {
      if (!state.chords.length) return;
      var index = getActiveChord().index;
      removeChordCanvas(state.chords[index].id);
      var remaining = state.chords.filter(function (chord, i) { return i !== index; });
      var noneLeft = remaining.length === 0;
      if (noneLeft) stopPlaybackTimers();
      endTransition();
      setState({
        chords: remaining,
        activeIndex: Math.max(0, Math.min(index, remaining.length - 1)),
        playing: noneLeft ? false : state.playing,
        beat: noneLeft ? -1 : state.beat
      });
    },

    // Add chord picker
    toggleChordPicker: function () { setState({ pickerOpen: !state.pickerOpen }); },
    selectPickerRoot: function (el) { setState({ pickerRoot: Number(el.dataset.value) }); },
    selectPickerQuality: function (el) { setState({ pickerQuality: el.dataset.value }); },
    addPickedChord: function () {
      var intervals = findPickerQuality(state.pickerQuality).intervals;
      var chords = state.chords.concat([createChord(state.pickerRoot, buildVoicing(state.pickerRoot, intervals))]);
      setState({ chords: chords, activeIndex: chords.length - 1, pickerOpen: false });
      if (state.strumOn) strumChord(getActiveChord().chord);
    },
    addBlankChord: function () {
      var chords = state.chords.concat([createChord(null)]);
      setState({ chords: chords, activeIndex: chords.length - 1, pickerOpen: false });
    },

    // Settings
    toggleMetronome: function () { setState({ metronomeOn: !state.metronomeOn }); },
    toggleStrum: function () { setState({ strumOn: !state.strumOn }); },
    tuneString: function (el) { retuneString(Number(el.dataset.string), Number(el.dataset.semitones)); },
    resetTuning: function () {
      for (var string = 0; string < STRING_COUNT; string++) {
        if (state.tuningOffsets[string]) retuneString(string, -state.tuningOffsets[string]);
      }
    },
    toggleMidi: function () {
      setState({ midiEnabled: !state.midiEnabled });
      if (state.midiEnabled) {
        requestMidi();
      } else {
        attachMidiInputs();
        setMidiStatus('');
        midiNoteShown = createGrid(false);
        renderMidiRings();
      }
    },

    /** Start from scratch: every chord, note and drawing goes, leaving one
     *  empty chord. Tuning and settings are kept. */
    startAgain: function () {
      stopPlaybackTimers();
      endTransition();
      Object.keys(chordCanvases).forEach(removeChordCanvas);
      emit('drawing');
      setState({
        title: '', chords: [createChord(null)], activeIndex: 0, beat: -1, playing: false,
        fullMap: false, transposeOffset: 0, pickerOpen: false, paintMode: false, eraserOn: false
      });
    }
  };

  /** Keyboard shortcuts carried over from the original app. */
  var arrowUpHeld = false;   // ↑ held while clicking = exclude note

  function isTypingTarget(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }

  function handleKeyDown(event) {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    var onButton = event.target && event.target.tagName === 'BUTTON';   // let Space/Enter press the button

    switch (event.key) {
      case 'ArrowUp':    arrowUpHeld = true; event.preventDefault(); break;
      case 'ArrowLeft':  stepChord(-1); event.preventDefault(); break;
      case 'ArrowRight': stepChord(1); event.preventDefault(); break;
      case ' ':          if (!onButton) { actions.toggleFullMap(); event.preventDefault(); } break;
      case 'Enter':      if (!onButton) actions.addBlankChord(); break;
      case 'p': case 'P': actions.togglePaintMode(); break;
      case 'e': case 'E': if (state.paintMode) actions.toggleEraser(); break;
      case 'n': case 'N': setState({ showNoteNames: !state.showNoteNames }); break;
      case 'm': case 'M': togglePlayback(); break;
      case 'b': case 'B': setState({ showProgression: !state.showProgression }); break;
      case 'f': case 'F': toggleFullscreen(); break;
    }
  }

  function handleClick(event) {
    var cell = event.target.closest('.fret-cell');
    if (cell) {
      getAudioContext();
      handleFretClick(Number(cell.dataset.string), Number(cell.dataset.fret), event.shiftKey, arrowUpHeld);
      return;
    }
    var control = event.target.closest('[data-action]');
    if (control && actions[control.dataset.action]) actions[control.dataset.action](control);
  }

  function bindEvents() {
    document.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', function (event) { if (event.key === 'ArrowUp') arrowUpHeld = false; });
    window.addEventListener('blur', function () { arrowUpHeld = false; });

    // Double-click on the fretboard toggles paint mode, as before.
    fretboardFrame.addEventListener('dblclick', actions.togglePaintMode);

    byId('tempoSlider').addEventListener('input', function (event) {
      setState({ bpm: parseInt(event.target.value, 10) || 100 });
      if (state.playing) startBeatTimer();
    });
    byId('volumeSlider').addEventListener('input', function (event) {
      setState({ volume: parseFloat(event.target.value) });
    });
    byId('transitionSlider').addEventListener('input', function (event) {
      setState({ transitionMs: parseInt(event.target.value, 10) || 0 });
    });

    var nameInput = byId('progressionName');
    nameInput.addEventListener('input', function () { setState({ title: nameInput.value }); });
    nameInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === 'Escape') nameInput.blur();
    });
    nameInput.addEventListener('blur', function () { setState({ title: nameInput.value.trim() }); });

    bindPaintEvents();
  }

  /* ========================================================================
   * 13. Saving and loading
   *
   * A session is plain JSON: the title, progression, tuning and display
   * settings, plus each chord's drawing as compact strokes. fretboard-
   * session.js stores it in the browser, in .json files and in share links.
   *
   * Saved strokes are arrays: [colour, thick (0/1), eraser (0/1), x0, y0,
   * then the change in x and y to each next point]. Small numbers keep files
   * and links short. `drawingSize` is the canvas size the points refer to,
   * so drawings scale to a fretboard of a different width.
   * ===================================================================== */

  var SESSION_VERSION = 2;
  var TITLE_MAX_LENGTH = 80;

  /** Settings saved with a session, with the type each must have. */
  var SAVED_SETTINGS = {
    bpm: 'number', metronomeOn: 'boolean', strumOn: 'boolean', volume: 'number', transitionMs: 'number',
    labelMode: 'string', colorByInterval: 'boolean', showNoteNames: 'boolean', fullMap: 'boolean'
  };

  function encodeStroke(stroke) {
    var saved = [stroke.color, stroke.width === 'thick' ? 1 : 0, stroke.eraser ? 1 : 0];
    var p = stroke.points;
    for (var i = 0; i + 1 < p.length; i += 2) {
      saved.push(i ? p[i] - p[i - 2] : p[i], i ? p[i + 1] - p[i - 1] : p[i + 1]);
    }
    return saved;
  }

  /** Saved stroke → Stroke scaled to this canvas, or null if malformed. */
  function decodeStroke(saved, scaleX, scaleY) {
    if (!Array.isArray(saved) || saved.length < 7 || !isInteger(saved[0], 0, BRUSH_COLORS.length - 1)) return null;
    var points = [];
    var x = 0;
    var y = 0;
    for (var i = 3; i + 1 < saved.length; i += 2) {
      if (!isNumber(saved[i]) || !isNumber(saved[i + 1])) return null;
      x = i === 3 ? saved[i] : x + saved[i];
      y = i === 3 ? saved[i + 1] : y + saved[i + 1];
      points.push(Math.round(x * scaleX), Math.round(y * scaleY));
    }
    return { color: saved[0], width: saved[1] === 1 ? 'thick' : 'thin', eraser: saved[2] === 1, points: points };
  }

  /** @param {{drawings?: boolean}} [options] drawings default to included */
  function serializeSession(options) {
    var withDrawings = !options || options.drawings !== false;
    var settings = {};
    Object.keys(SAVED_SETTINGS).forEach(function (name) { settings[name] = state[name]; });
    return {
      app: 'fretnoodle',
      version: SESSION_VERSION,
      title: state.title,
      drawingSize: canvasSize ? [canvasSize.width, canvasSize.height] : null,
      chords: state.chords.map(function (chord) {
        var saved = { root: chord.root, bars: chord.bars, positions: chord.positions, excluded: chord.excluded || [] };
        var strokes = withDrawings ? chordStrokes[chord.id] || [] : [];
        if (strokes.length) saved.strokes = strokes.map(encodeStroke);
        return saved;
      }),
      activeIndex: getActiveChord().index,
      transposeOffset: state.transposeOffset,
      tuningOffsets: state.tuningOffsets,
      settings: settings
    };
  }

  function isNumber(value) { return typeof value === 'number' && isFinite(value); }

  function isInteger(value, min, max) {
    return typeof value === 'number' && value % 1 === 0 && value >= min && value <= max;
  }

  /**
   * Replace the current session with saved data. Anything malformed is
   * dropped or clamped rather than trusted.
   * @throws {Error} when the data is not a Fretnoodle session
   */
  function loadSession(data) {
    if (!data || data.app !== 'fretnoodle' || !Array.isArray(data.chords)) {
      throw new Error('This is not a Fretnoodle session file.');
    }

    stopPlaybackTimers();
    endTransition();
    Object.keys(chordCanvases).forEach(removeChordCanvas);

    var tuningOffsets = [0, 0, 0, 0, 0, 0].map(function (zero, string) {
      var offset = Array.isArray(data.tuningOffsets) ? data.tuningOffsets[string] : 0;
      return isInteger(offset, -12, 12) ? offset : 0;
    });

    var drawings = [];
    var chords = data.chords.slice(0, 64).map(function (saved) {
      saved = saved || {};
      var positions = uniquePositions((Array.isArray(saved.positions) ? saved.positions : []).filter(function (position) {
        return Array.isArray(position) && isInteger(position[0], 0, STRING_COUNT - 1) && isInteger(position[1], 0, FRET_COUNT);
      }).map(function (position) { return [position[0], position[1]]; }));
      var chord = createChord(isInteger(saved.root, 0, 11) ? saved.root : null, positions);
      chord.bars = isInteger(saved.bars, 1, 16) ? saved.bars : 1;
      chord.excluded = (Array.isArray(saved.excluded) ? saved.excluded : []).filter(function (pc) { return isInteger(pc, 0, 11); });
      if (Array.isArray(saved.strokes) && saved.strokes.length) drawings.push({ chord: chord, strokes: saved.strokes });
      return chord;
    });
    if (!chords.length) chords = [createChord(null)];

    var changes = {
      chords: chords,
      activeIndex: isInteger(data.activeIndex, 0, chords.length - 1) ? data.activeIndex : 0,
      transposeOffset: isInteger(data.transposeOffset, -99, 99) ? data.transposeOffset : 0,
      tuningOffsets: tuningOffsets,
      playing: false, beat: -1, pickerOpen: false, paintMode: false, eraserOn: false,
      title: typeof data.title === 'string' ? data.title.slice(0, TITLE_MAX_LENGTH) : ''
    };
    var settings = data.settings || {};
    Object.keys(SAVED_SETTINGS).forEach(function (name) {
      if (typeof settings[name] === SAVED_SETTINGS[name]) changes[name] = settings[name];
    });
    changes.bpm = Math.max(40, Math.min(220, Math.round(changes.bpm || state.bpm)));
    changes.volume = Math.max(0, Math.min(1, changes.volume === undefined ? state.volume : changes.volume));
    changes.transitionMs = Math.max(0, Math.min(1200, changes.transitionMs === undefined ? state.transitionMs : changes.transitionMs));
    if (changes.labelMode !== 'notes') changes.labelMode = 'intervals';

    setState(changes);

    drawings.forEach(function (item) {
      getChordCanvas(item.chord);   // fixes canvasSize if this is the first canvas
      var size = Array.isArray(data.drawingSize) && data.drawingSize[0] > 0 && data.drawingSize[1] > 0
        ? data.drawingSize : [canvasSize.width, canvasSize.height];
      chordStrokes[item.chord.id] = item.strokes.slice(0, 2000).map(function (saved) {
        return decodeStroke(saved, canvasSize.width / size[0], canvasSize.height / size[1]);
      }).filter(Boolean);
      redrawChord(item.chord);
    });
    showActiveCanvas();
  }

  /** Name and chip data for a chord, or null if it has no notes. */
  function describeChord(chord) {
    var analysis = analyzeChord(chord);
    if (!analysis) return null;
    return {
      root: NOTE_NAMES[analysis.root],
      quality: analysis.qualityText,
      named: !!analysis.quality,   // false when quality is just a list of notes
      tones: chordTones(analysis, chord.excluded || [])
    };
  }

  /**
   * The dots a chord shows on the board, as renderFretboard draws them.
   * @returns {Array<{string:number, fret:number, label:string, color:string, ringed:boolean, excluded:boolean}>}
   */
  function chordDots(chord, fullMap) {
    var analysis = analyzeChord(chord);
    if (!analysis) return [];
    var excluded = chord.excluded || [];
    var entered = {};
    chord.positions.forEach(function (position) { entered[position[0] + '-' + position[1]] = true; });

    var dots = [];
    for (var string = 0; string < STRING_COUNT; string++) {
      for (var fret = 0; fret <= FRET_COUNT; fret++) {
        var pitchClass = pitchClassAt(string, fret);
        var interval = (pitchClass - analysis.root + 12) % 12;
        var isEntered = !!entered[string + '-' + fret];
        if (analysis.intervals.indexOf(interval) < 0 || !(fullMap || isEntered)) continue;
        dots.push({
          string: string,
          fret: fret,
          label: state.labelMode === 'notes' ? NOTE_NAMES[pitchClass] : intervalLabel(interval, analysis.quality),
          color: intervalColor(interval),
          ringed: fullMap && isEntered,
          excluded: excluded.indexOf(pitchClass) >= 0
        });
      }
    }
    return dots;
  }

  /**
   * Small public API used by fretboard-tutorial.js and fretboard-session.js.
   */
  window.Fretnoodle = {
    getState: function () { return state; },
    setState: setState,
    on: function (type, listener) { listeners[type].push(listener); },

    serializeSession: serializeSession,
    loadSession: loadSession,
    describeChord: describeChord,
    chordDots: chordDots,
    noteName: function (string, fret) { return NOTE_NAMES[pitchClassAt(string, fret)]; },
    openStringName: function (string) { return NOTE_NAMES[openStringPitchClass(string)]; },
    /** The chord's drawing canvas, or null if nothing has been drawn on it. */
    getDrawing: function (chord) {
      return chordStrokes[chord.id] && chordStrokes[chord.id].length ? chordCanvases[chord.id] || null : null;
    },
    /** Short name from the chords, e.g. "Amin – Dmaj – E7", for untitled progressions. */
    suggestTitle: function () {
      var names = state.chords.map(describeChord).filter(Boolean).map(function (d) {
        return (d.root + (d.named ? d.quality : ' ' + d.quality)).trim();
      });
      return names.slice(0, 4).join(' – ') + (names.length > 4 ? ' …' : '');
    }
  };

  /* Start-up */
  buildFretboard();
  bindEvents();
  preloadSamples();
  render();
})();
