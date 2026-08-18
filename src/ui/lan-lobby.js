const PHASE_COPY = Object.freeze({
  "creating-offer": "CREATING LOCAL INVITE...",
  "offer-ready": "INVITE READY — SEND IT TO PLAYER 2.",
  "accepting-answer": "ACCEPTING PLAYER 2 ANSWER...",
  "waiting-for-peer": "CONNECTING DIRECTLY ON LAN...",
  "creating-answer": "READING HOST INVITE...",
  "answer-ready": "ANSWER READY — SEND IT BACK TO THE HOST.",
  "waiting-for-ready": "DATA LINK OPEN — WAITING FOR PLAYER 2.",
  "waiting-for-host": "DATA LINK OPEN — VERIFYING HOST MATCH.",
  ready: "READY — WAITING FOR HOST TO START.",
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
  clipboard = globalThis.navigator?.clipboard
}) {
  const hostMode = document.querySelector("#lan-host-mode");
  const hostCreate = document.querySelector("#lan-create-invite");
  const hostOffer = document.querySelector("#lan-host-offer");
  const hostCopy = document.querySelector("#lan-copy-offer");
  const hostAnswer = document.querySelector("#lan-host-answer");
  const hostConnect = document.querySelector("#lan-accept-answer");
  const hostStatus = document.querySelector("#lan-host-status");
  const joinOffer = document.querySelector("#lan-join-offer");
  const joinCreate = document.querySelector("#lan-create-answer");
  const joinAnswer = document.querySelector("#lan-join-answer");
  const joinCopy = document.querySelector("#lan-copy-answer");
  const joinStatus = document.querySelector("#lan-join-status");
  const lanNotice = document.querySelector("#lan-notice");

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

  async function copyText(textarea, role) {
    const text = textarea.value.trim();
    if (!text) return;
    try {
      if (!clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await clipboard.writeText(text);
      setLocalStatus(role, "COPIED TO CLIPBOARD.");
    } catch {
      textarea.focus();
      textarea.select();
      setLocalStatus(role, "COPY THE SELECTED TEXT MANUALLY.");
    }
  }

  hostCreate.addEventListener("click", async () => {
    setBusy(hostCreate, true);
    hostOffer.value = "";
    hostAnswer.value = "";
    try {
      const offer = await createHostInvite(hostMode.value);
      hostOffer.value = offer;
      hostCopy.disabled = false;
      hostConnect.disabled = false;
    } catch (error) {
      if (error?.name !== "AbortError") setLocalStatus("host", errorMessage(error), true);
    } finally {
      setBusy(hostCreate, false);
    }
  });

  hostConnect.addEventListener("click", async () => {
    setBusy(hostConnect, true);
    try {
      await acceptHostAnswer(hostAnswer.value);
    } catch (error) {
      if (error?.name !== "AbortError") setLocalStatus("host", errorMessage(error), true);
    } finally {
      setBusy(hostConnect, false);
    }
  });

  joinCreate.addEventListener("click", async () => {
    setBusy(joinCreate, true);
    joinAnswer.value = "";
    try {
      const answer = await createJoinAnswer(joinOffer.value);
      joinAnswer.value = answer;
      joinCopy.disabled = false;
    } catch (error) {
      if (error?.name !== "AbortError") setLocalStatus("join", errorMessage(error), true);
    } finally {
      setBusy(joinCreate, false);
    }
  });

  hostCopy.addEventListener("click", () => copyText(hostOffer, "host"));
  joinCopy.addEventListener("click", () => copyText(joinAnswer, "join"));

  function setSessionState(snapshot) {
    if (!snapshot?.role) return;
    setLocalStatus(snapshot.role === "host" ? "host" : "join", getLanStatusText(snapshot), Boolean(snapshot.error));
    if (snapshot.state === "failed" || snapshot.state === "disconnected" || snapshot.state === "idle") {
      hostCreate.disabled = false;
      joinCreate.disabled = false;
      if (snapshot.role === "host") hostConnect.disabled = true;
    }
  }

  function resetRole(role) {
    if (role === "host") {
      hostOffer.value = "";
      hostAnswer.value = "";
      hostCopy.disabled = true;
      hostConnect.disabled = true;
      setLocalStatus("host", "CHOOSE CLASSIC VS, THEN CREATE AN INVITE.");
    } else {
      joinOffer.value = "";
      joinAnswer.value = "";
      joinCopy.disabled = true;
      setLocalStatus("join", "PASTE THE HOST INVITE TO CREATE YOUR ANSWER.");
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
      if (screenName === "lan-host") resetRole("host");
      if (screenName === "lan-join") resetRole("join");
    }
  };
}
