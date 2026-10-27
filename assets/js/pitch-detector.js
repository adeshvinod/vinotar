/**
 * Fretnoodle — Pitch detector
 *
 * Turns microphone audio into guitar notes for the ear trainer
 * (ear-training.html). Plain JavaScript; also loads in Node for testing
 * (module.exports).
 *
 *   yin(buffer, sampleRate)   One window of samples → { frequency, clarity }
 *                             or null when there is no clear pitch. YIN
 *                             (de Cheveigné & Kawahara, 2002), limited to the
 *                             guitar's range.
 *   NoteTracker               Feed it one window per animation frame
 *                             (ideally band-limited to the guitar's range
 *                             first: see ear-trainer.js). It gates out room
 *                             noise just above the measured room level, waits for a pitch to hold
 *                             steady for a few frames, and emits one note
 *                             event per played note (a re-pluck of the same
 *                             note counts again).
 *
 * Octaves: a low string's attack can read an octave high for a moment (its
 * second harmonic is louder than the fundamental), and a decaying note can
 * flicker between octaves. So, without a new pluck, an octave jump is not a
 * new note: if it settles an octave lower soon after the event, a correction
 * event ({ corrects: previous midi }) is sent; later octave flicker is ignored.
 */
(function (root) {
  'use strict';

  var MIN_FREQUENCY = 70;      // Hz, below a low E (82 Hz) for drop tunings
  var MAX_FREQUENCY = 1400;    // Hz, above the 24th fret of the high E
  var YIN_THRESHOLD = 0.15;    // lower = stricter about what counts as pitched
  var YIN_FALLBACK = 0.35;     // accept the best dip up to this if none beat the threshold
  var MAX_SUBHARMONIC = 10;    // check periods down to best/10 (see the subharmonic check)
  var SUBHARMONIC_TOLERANCE = 0.1;   // how much shallower that dip may be (0.2 starts reading notes too high)
  var MIN_GATE = 0.0015;       // quietest level ever treated as playing
  var GATE_ABOVE_NOISE = 2.5;  // playing must be this many times louder than the room

  /** Root-mean-square level of a window (0 = silence, ~0.7 = full scale sine). */
  function rms(buffer) {
    var sum = 0;
    for (var i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  /**
   * YIN pitch estimate.
   * @param {Float32Array} buffer  at least 2 × the longest period (2048 at 48 kHz is plenty)
   * @returns {{frequency:number, clarity:number}|null}  clarity 0–1
   */
  function yin(buffer, sampleRate) {
    var tauMin = Math.floor(sampleRate / MAX_FREQUENCY);
    var tauMax = Math.min(Math.floor(sampleRate / MIN_FREQUENCY), Math.floor(buffer.length / 2));
    var size = buffer.length - tauMax;
    var diff = new Float32Array(tauMax + 1);

    // Difference function, then cumulative mean normalised difference.
    for (var tau = 1; tau <= tauMax; tau++) {
      var total = 0;
      for (var i = 0; i < size; i++) {
        var delta = buffer[i] - buffer[i + tau];
        total += delta * delta;
      }
      diff[tau] = total;
    }
    diff[0] = 1;
    var running = 0;
    for (tau = 1; tau <= tauMax; tau++) {
      running += diff[tau];
      diff[tau] = running ? diff[tau] * tau / running : 1;
    }

    // First dip below the threshold (take the bottom of that dip), else the best dip.
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (diff[tau] < YIN_THRESHOLD) {
        while (tau + 1 <= tauMax && diff[tau + 1] < diff[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      for (tau = tauMin; tau <= tauMax; tau++) if (best < 0 || diff[tau] < diff[best]) best = tau;
      if (diff[best] > YIN_FALLBACK) return null;
    }

    // Subharmonic check: in weak or noisy sound the dip at the true period can
    // miss the threshold while the one at 2, 3, 4… periods doesn't, which
    // reads a D4 as G2 (D4 is G2's third harmonic). If a lag of best/k has a
    // dip nearly as deep, that shorter lag is the real period.
    for (var k = MAX_SUBHARMONIC; k >= 2; k--) {
      var guess = Math.round(best / k);
      if (guess < tauMin) continue;
      var dip = guess;
      for (var j = Math.max(tauMin, guess - 2); j <= Math.min(tauMax, guess + 2); j++) if (diff[j] < diff[dip]) dip = j;
      if (diff[dip] <= diff[best] + SUBHARMONIC_TOLERANCE) { best = dip; break; }
    }

    // Parabolic interpolation around the dip for sub-sample accuracy.
    var refined = best;
    if (best > 1 && best < tauMax) {
      var a = diff[best - 1], b = diff[best], c = diff[best + 1];
      var denominator = a - 2 * b + c;
      if (denominator) refined = best + (a - c) / (2 * denominator);
    }
    return { frequency: sampleRate / refined, clarity: 1 - diff[best] };
  }

  function midiFromFrequency(frequency) {
    return 69 + 12 * Math.log(frequency / 440) / Math.LN2;
  }

  /**
   * @param {{sampleRate:number, stableFrames?:number}} options
   */
  function NoteTracker(options) {
    this.sampleRate = options.sampleRate;
    this.stableFrames = options.stableFrames || 4;   // ~70 ms at 60 frames/s
    this.gate = 0.004;           // level below this is silence; set from the room by calibrate()
    this.candidate = null;       // MIDI note being confirmed
    this.count = 0;              // frames the candidate has held
    this.sounding = null;        // MIDI note last emitted, until silence or a new note
    this.levels = [];            // recent levels, for spotting a re-pluck
    this.sinceEvent = Infinity;  // frames since the last note event
    this.refractory = options.refractoryFrames || 15;  // ~250 ms: a pluck's swell isn't a re-pluck
    this.settle = options.settleFrames || 12;          // ~200 ms in which an octave-low correction is accepted
    this.armed = true;           // false after reset(true): wait for silence or a new pluck
  }

  /** Set the noise gate from a stretch of room sound (array of levels). */
  NoteTracker.prototype.calibrate = function (levels) {
    if (!levels.length) return;
    var sorted = levels.slice().sort(function (a, b) { return a - b; });
    var typical = sorted[Math.floor(sorted.length * 0.9)];
    this.gate = Math.max(MIN_GATE, typical * GATE_ABOVE_NOISE);
  };

  /**
   * Forget the current note. With `requireOnset`, sound still ringing from
   * before (the app's own notes, the room, a string left ringing) is ignored
   * until there is a moment of silence or a new pluck.
   */
  NoteTracker.prototype.reset = function (requireOnset) {
    this.candidate = null;
    this.count = 0;
    this.sounding = null;
    this.levels = [];
    this.sinceEvent = Infinity;
    this.armed = !requireOnset;
  };

  /**
   * @returns {{level:number, gated:boolean, midi:number|null, cents:number, frequency:number|null,
   *            event:null|{midi:number, cents:number}}}
   */
  NoteTracker.prototype.push = function (buffer) {
    var level = rms(buffer);
    // Hysteresis: a ringing note only ends well below the gate, so a fade
    // that wobbles around the gate doesn't read as a new note.
    var gate = this.sounding !== null ? this.gate * 0.5 : this.gate;
    var reading = { level: level, gated: level < gate, midi: null, cents: 0, frequency: null, event: null };

    // A sharp rise in level is a new pluck: the same note may count again.
    var before = this.levels.length >= 3 ? this.levels[this.levels.length - 3] : level;
    this.levels.push(level);
    if (this.levels.length > 6) this.levels.shift();
    this.sinceEvent++;
    if (level > before * 1.6 && level > this.gate * 2 && this.sinceEvent > this.refractory) {
      this.sounding = null;
      this.armed = true;
    }

    if (reading.gated) {
      this.armed = true;
      this.candidate = null;
      this.count = 0;
      this.sounding = null;
      return reading;
    }

    var pitch = yin(buffer, this.sampleRate);
    if (!pitch) { this.count = 0; return reading; }

    var exact = midiFromFrequency(pitch.frequency);
    var midi = Math.round(exact);
    reading.frequency = pitch.frequency;
    reading.midi = midi;
    reading.cents = Math.round((exact - midi) * 100);

    if (midi === this.candidate) this.count++;
    else { this.candidate = midi; this.count = 1; }

    if (this.armed && this.count >= this.stableFrames && this.sounding !== midi) {
      var octaveJump = this.sounding !== null && Math.abs(midi - this.sounding) === 12;
      if (octaveJump) {
        if (midi === this.sounding - 12 && this.sinceEvent <= this.settle) {
          reading.event = { midi: midi, cents: reading.cents, corrects: this.sounding };
          this.sounding = midi;
        }
        return reading;   // otherwise octave flicker on a ringing note
      }
      this.sounding = midi;
      this.sinceEvent = 0;
      reading.event = { midi: midi, cents: reading.cents };
    }
    return reading;
  };

  var api = { yin: yin, rms: rms, midiFromFrequency: midiFromFrequency, NoteTracker: NoteTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PitchDetector = api;
})(this);
