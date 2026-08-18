import { cameraQrScanSupport, renderQrCode, startCameraQrScanner } from "./qr-code.js";

const PHASE_COPY = Object.freeze({
  "creating-offer": "CREATING LOCAL INVITE...",
  "offer-ready": "INVITE READY — COPY IT OR LET PLAYER 2 SCAN THE QR CODE.",
  "accepting-answer": "ACCEPTING PLAYER 2 ANSWER...",
  "waiting-for-peer": "CONNECTING DIRECTLY ON LAN...",
  "creating-answer": "READING HOST INVITE...",
  "answer-ready": "ANSWER READY — COPY IT OR LET THE HOST SCAN THE QR CODE.",
  "waiting-for-ready": "DATA LINK OPEN — WAITING FOR PLAYER 2.",
  "waiting-for-host": "DATA LINK OPEN — VERIFYING HOST MATCH.",
  ready: "READY — WAITING FOR HOST TO START.",
  "ready-to-start": "PLAYER 2 READY — START WHEN YOU'RE READY.",
  "sending-match-start": "STARTING MATCH...",
  playing: "LAN MATCH CONNECTED.",
  finished: "MATCH COMPLETE.",
  failed: "CONNECTION FAILED.",
  disconnected: "PEER DISCONNECTED."
});

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "LAN operation failed");
}

export function getLanStatusText(snapshot) {
  if (!snapshot) return "READY FOR DIRECT LAN CONNECTION.";
  if (snapshot.error) return `${PHASE_COPY[snapshot.phase] || "CONNECTION ERROR."} ${snapshot.error}`;
  return PHASE_COPY[snapshot.phase] || "READY FOR DIRECT LAN CONNECTION.";
}

export function createLanLobby({
  modes,
  createHostInvite,
  acceptHostAnswer,
  createJoinAnswer,
  startHostMatch,
  clipboard = globalThis.navigator?.clipboard
}) {
  const hostMode = document.querySelector("#lan-host-mode");
  const hostCreate = document.querySelector("#lan-create-invite");
  const hostSetupStep = document.querySelector("#lan-host-setup-step");
  const hostInviteStep = document.querySelector("#lan-host-invite-step");
  const hostOfferQr = document.querySelector("#lan-host-offer-qr");
  const hostCopy = document.querySelector("#lan-copy-offer");
  const hostNext = document.querySelector("#lan-host-next");
  const hostAnswerStep = document.querySelector("#lan-host-answer-step");
  const hostAnswer = document.querySelector("#lan-host-answer");
  const hostScan = document.querySelector("#lan-scan-answer");
  const hostScanner = document.querySelector("#lan-host-scanner");
  const hostScanVideo = document.querySelector("#lan-host-scan-video");
  const hostCancelScan = document.querySelector("#lan-cancel-answer-scan");
  const hostConnect = document.querySelector("#lan-accept-answer");
  const hostStartStep = document.querySelector("#lan-host-start-step");
  const hostStart = document.querySelector("#lan-start-match");
  const hostStatus = document.querySelector("#lan-host-status");

  const joinInviteStep = document.querySelector("#lan-join-invite-step");
  const joinOffer = document.querySelector("#lan-join-offer");
  const joinScan = document.querySelector("#lan-scan-offer");
  const joinScanner = document.querySelector("#lan-join-scanner");
  const joinScanVideo = document.querySelector("#lan-join-scan-video");
  const joinCancelScan = document.querySelector("#lan-cancel-offer-scan");
  const joinCreate = document.querySelector("#lan-create-answer");
  const joinAnswerStep = document.querySelector("#lan-join-answer-step");
  const joinAnswerQr = document.querySelector("#lan-join-answer-qr");
  const joinCopy = document.querySelector("#lan-copy-answer");
  const joinStatus = document.querySelector("#lan-join-status");
  const lanNotice = document.querySelector("#lan-notice");

  let hostInviteCode = "";
  let joinAnswerCode = "";
  const scans = {
    host: { generation: 0, stop: null, panel: hostScanner },
    join: { generation: 0, stop: null, panel: joinScanner }
  };

  for (const mode of modes) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.name.toUpperCase();
    hostMode.append(option);
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function setLocalStatus(role, text, isError = false) {
    const output = role === "host" ? hostStatus : joinStatus;
    output.textContent = text;
    output.dataset.error = isError ? "true" : "false";
  }

  function focusStage(stage) {
    requestAnimationFrame(() => stage?.querySelector("input, select, button:not([disabled])")?.focus());
  }

  function setHostStage(stageName, { focus = false } = {}) {
    const stages = {
      setup: hostSetupStep,
      invite: hostInviteStep,
      answer: hostAnswerStep,
      start: hostStartStep
    };
    for (const [name, stage] of Object.entries(stages)) stage.hidden = name !== stageName;
    if (focus) focusStage(stages[stageName]);
  }

  function setJoinStage(stageName, { focus = false } = {}) {
    joinInviteStep.hidden = stageName !== "invite";
    joinAnswerStep.hidden = stageName !== "answer";
    if (focus) focusStage(stageName === "invite" ? joinInviteStep : joinAnswerStep);
  }

  function syncHostAnswerButton() {
    if (hostConnect.getAttribute("aria-busy") === "true") return;
    hostConnect.disabled = hostAnswer.value.trim() === "";
  }

  function syncJoinCreateButton() {
    if (joinCreate.getAttribute("aria-busy") === "true") return;
    joinCreate.disabled = joinOffer.value.trim() === "";
  }

  async function copyCode(code, role, label) {
    if (!code) return;
    try {
      if (!clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await clipboard.writeText(code);
      setLocalStatus(role, `${label} COPIED TO CLIPBOARD.`);
    } catch {
      setLocalStatus(role, `COPY FAILED — USE THE ${label} QR CODE INSTEAD.`, true);
    }
  }

  function stopScan(role) {
    const scan = scans[role];
    scan.generation += 1;
    scan.stop?.();
    scan.stop = null;
    scan.panel.hidden = true;
  }

  async function beginScan(role, { input, video, label }) {
    stopScan(role);
    const scan = scans[role];
    const generation = scan.generation;
    const support = cameraQrScanSupport();
    if (!support.supported) {
      setLocalStatus(role, support.reason, true);
      return;
    }

    scan.panel.hidden = false;
    setLocalStatus(role, `OPENING CAMERA FOR ${label} QR...`);
    try {
      const stop = await startCameraQrScanner(video, {
        onResult(value) {
          if (generation !== scan.generation) return;
          scan.stop = null;
          scan.panel.hidden = true;
          input.value = value;
          if (role === "host") syncHostAnswerButton();
          else syncJoinCreateButton();
          setLocalStatus(role, `${label} QR SCANNED.`);
          input.focus();
        },
        onError(error) {
          if (generation !== scan.generation) return;
          scan.stop = null;
          scan.panel.hidden = true;
          setLocalStatus(role, errorMessage(error), true);
        }
      });
      if (generation !== scan.generation) stop();
      else scan.stop = stop;
    } catch (error) {
      if (generation !== scan.generation) return;
      scan.panel.hidden = true;
      setLocalStatus(role, errorMessage(error), true);
    }
  }

  hostAnswer.addEventListener("input", syncHostAnswerButton);
  joinOffer.addEventListener("input", syncJoinCreateButton);

  hostCreate.addEventListener("click", async () => {
    setBusy(hostCreate, true);
    hostMode.disabled = true;
    hostInviteCode = "";
    try {
      const invite = await createHostInvite(hostMode.value);
      hostInviteCode = invite;
      renderQrCode(hostOfferQr, invite);
      hostCopy.disabled = false;
      setHostStage("invite", { focus: true });
    } catch (error) {
      hostMode.disabled = false;
      setBusy(hostCreate, false);
      if (error?.name !== "AbortError") setLocalStatus("host", errorMessage(error), true);
    }
  });

  hostNext.addEventListener("click", () => {
    setHostStage("answer", { focus: true });
    setLocalStatus("host", "PASTE PLAYER 2 ANSWER OR SCAN THEIR QR CODE.");
  });

  hostConnect.addEventListener("click", async () => {
    setBusy(hostConnect, true);
    try {
      await acceptHostAnswer(hostAnswer.value);
    } catch (error) {
      if (error?.name !== "AbortError") setLocalStatus("host", errorMessage(error), true);
    } finally {
      hostConnect.setAttribute("aria-busy", "false");
      syncHostAnswerButton();
    }
  });

  hostStart.addEventListener("click", async () => {
    setBusy(hostStart, true);
    try {
      await startHostMatch();
    } catch (error) {
      setLocalStatus("host", errorMessage(error), true);
      setBusy(hostStart, false);
    }
  });

  joinCreate.addEventListener("click", async () => {
    setBusy(joinCreate, true);
    joinAnswerCode = "";
    try {
      const answer = await createJoinAnswer(joinOffer.value);
      joinAnswerCode = answer;
      renderQrCode(joinAnswerQr, answer);
      joinCopy.disabled = false;
      setJoinStage("answer", { focus: true });
    } catch (error) {
      if (error?.name !== "AbortError") setLocalStatus("join", errorMessage(error), true);
    } finally {
      joinCreate.setAttribute("aria-busy", "false");
      syncJoinCreateButton();
    }
  });

  hostCopy.addEventListener("click", () => copyCode(hostInviteCode, "host", "INVITE"));
  joinCopy.addEventListener("click", () => copyCode(joinAnswerCode, "join", "ANSWER"));
  hostScan.addEventListener("click", () => beginScan("host", {
    input: hostAnswer,
    video: hostScanVideo,
    label: "ANSWER"
  }));
  joinScan.addEventListener("click", () => beginScan("join", {
    input: joinOffer,
    video: joinScanVideo,
    label: "INVITE"
  }));
  hostCancelScan.addEventListener("click", () => {
    stopScan("host");
    setLocalStatus("host", "CAMERA SCAN CANCELLED — PASTE THE ANSWER CODE INSTEAD.");
  });
  joinCancelScan.addEventListener("click", () => {
    stopScan("join");
    setLocalStatus("join", "CAMERA SCAN CANCELLED — PASTE THE INVITE CODE INSTEAD.");
  });

  function setSessionState(snapshot) {
    if (!snapshot?.role) return;
    const role = snapshot.role === "host" ? "host" : "join";
    setLocalStatus(role, getLanStatusText(snapshot), Boolean(snapshot.error));

    if (role === "host") {
      if (snapshot.phase === "offer-ready") setHostStage("invite");
      else if (["accepting-answer", "waiting-for-peer", "waiting-for-ready"].includes(snapshot.phase)) {
        setHostStage("answer");
      } else if (["ready-to-start", "sending-match-start"].includes(snapshot.phase)) {
        stopScan("host");
        setHostStage("start", { focus: snapshot.phase === "ready-to-start" });
        hostStart.disabled = snapshot.phase !== "ready-to-start";
      } else if (["failed", "disconnected"].includes(snapshot.state)) {
        stopScan("host");
        hostInviteCode = "";
        hostAnswer.value = "";
        hostMode.disabled = false;
        setBusy(hostCreate, false);
        syncHostAnswerButton();
        setHostStage("setup", { focus: true });
      }
      return;
    }

    if (["answer-ready", "waiting-for-host", "ready"].includes(snapshot.phase)) {
      stopScan("join");
      setJoinStage("answer");
    } else if (["failed", "disconnected"].includes(snapshot.state)) {
      stopScan("join");
      joinAnswerCode = "";
      setJoinStage("invite", { focus: true });
      syncJoinCreateButton();
    }
  }

  function resetRole(role) {
    stopScan(role);
    if (role === "host") {
      hostInviteCode = "";
      hostAnswer.value = "";
      renderQrCode(hostOfferQr, "");
      hostCopy.disabled = true;
      hostMode.disabled = false;
      setBusy(hostCreate, false);
      hostStart.disabled = false;
      hostStart.setAttribute("aria-busy", "false");
      syncHostAnswerButton();
      setHostStage("setup");
      setLocalStatus("host", "CHOOSE A VS RULESET, THEN CREATE AN INVITE.");
    } else {
      joinAnswerCode = "";
      joinOffer.value = "";
      renderQrCode(joinAnswerQr, "");
      joinCopy.disabled = true;
      joinCreate.setAttribute("aria-busy", "false");
      syncJoinCreateButton();
      setJoinStage("invite");
      setLocalStatus("join", "PASTE THE HOST INVITE OR SCAN ITS QR CODE.");
    }
  }

  resetRole("host");
  resetRole("join");

  return {
    setSessionState,
    setNotice(message = "") {
      lanNotice.textContent = message;
      lanNotice.hidden = !message;
    },
    handleScreenChange(screenName) {
      if (screenName !== "lan-host") stopScan("host");
      if (screenName !== "lan-join") stopScan("join");
      if (screenName === "lan-host") resetRole("host");
      if (screenName === "lan-join") resetRole("join");
    }
  };
}
