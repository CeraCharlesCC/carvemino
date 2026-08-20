export class FakeAudioParam {
  constructor() {
    this.values = [];
  }

  cancelScheduledValues() {}

  setValueAtTime(value, time) {
    this.values.push(["set", value, time]);
  }

  setTargetAtTime() {}

  exponentialRampToValueAtTime(value, time) {
    this.values.push(["ramp", value, time]);
  }
}

export class FakeGain {
  constructor() {
    this.gain = new FakeAudioParam();
  }

  connect() {}
  disconnect() {}
}

export class FakeOscillator {
  constructor() {
    this.frequency = new FakeAudioParam();
    this.type = "sine";
    this.started = [];
    this.stopped = [];
  }

  connect() {}
  disconnect() {}
  start(time) { this.started.push(time); }
  stop(time) { this.stopped.push(time); }
}

export class FakeAudioContext {
  constructor({ currentTime = 10 } = {}) {
    this.currentTime = currentTime;
    this.state = "running";
    this.destination = {};
    this.oscillators = [];
  }

  createGain() {
    return new FakeGain();
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  close() {}
}