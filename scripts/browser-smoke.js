(async () => {
  const checks = [];
  function assert(value, label) {
    if (!value) throw new Error(label);
    checks.push(label);
  }
  async function until(check) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Browser state did not settle");
  }
  const button = (label) =>
    [...document.querySelectorAll("button")].find(
      (node) => node.textContent === label,
    );
  assert(
    button("Find my song")?.disabled,
    "Submission disabled before image selection",
  );
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const context = canvas.getContext("2d");
  context.fillStyle = "#637b71";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  const input = document.querySelector('input[aria-label="Upload a photo"]');
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "test-scene.png", { type: "image/png" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document.querySelector(".photo-preview img") &&
      !button("Find my song")?.disabled,
  );
  assert(
    !!document.querySelector(".photo-preview img"),
    "Selected photo preview rendered",
  );
  const params = [
    "energy",
    "positivity",
    "tempo",
    "texture",
    "space",
    "nostalgia",
  ];
  const songs = [
    ["Teardrop", "Massive Attack"],
    ["Holocene", "Bon Iver"],
    ["Dreams", "Fleetwood Mac"],
    ["Space Song", "Beach House"],
    ["Pink Moon", "Nick Drake"],
    ["Intro", "The xx"],
    ["A Walk", "Tycho"],
    ["Everything In Its Right Place", "Radiohead"],
  ];
  const weights = {
    energy: 0.01,
    positivity: 0.49,
    tempo: 0.125,
    texture: 0.125,
    space: 0.125,
    nostalgia: 0.125,
  };
  const result = {
    requestId: "browser-smoke",
    vibe_summary: "A quiet scene in soft green light.",
    photo_profile: Object.fromEntries(
      params.map((p) => [
        p,
        { score: 3, evidence: "Muted green light and still surroundings" },
      ]),
    ),
    weights,
    weights_reason: "The soft light and stillness matter most.",
    winnerId: 1,
    candidates: songs.map(([title, artist], id) => ({
      id,
      rank: id + 1,
      title,
      artist,
      fit_note: "A gentle arrangement for a quiet scene.",
      score: 100 - id * 10,
      profile: Object.fromEntries(params.map((p) => [p, 3 + id])),
      gaps: Object.fromEntries(params.map((p) => [p, id])),
      resolution:
        id === 1
          ? {
              kind: "verified",
              trackId: "35KiiILklye1JRRctaLUb4",
              uri: "spotify:track:35KiiILklye1JRRctaLUb4",
              url: "https://open.spotify.com/track/35KiiILklye1JRRctaLUb4",
              title,
              artist,
            }
          : {
              kind: "unverified",
              url: `https://open.spotify.com/search/${encodeURIComponent(title + " " + artist)}`,
            },
    })),
  };
  const originalFetch = window.fetch;
  let calls = 0;
  window.fetch = async (url, options) => {
    if (url === "/api/recommend") {
      calls++;
      const photo = options.body.get("photo");
      assert(photo.type === "image/jpeg", "Browser sends JPEG");
      const bitmap = await createImageBitmap(photo);
      assert(
        bitmap.width === 768 && bitmap.height === 512,
        "Browser scales longest side to 768 pixels",
      );
      bitmap.close();
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };
  try {
    button("Find my song").click();
    button("Find my song")?.click();
    await until(() => document.querySelectorAll(".candidates li").length === 8);
    assert(calls === 1, "Rapid double clicks make one recommendation request");
    assert(
      document.querySelector("#winner-title")?.textContent === "Holocene",
      "Highest verified song rendered as winner",
    );
    assert(
      document.querySelector(".fallback-note")?.textContent.includes("#2"),
      "Unverified top song explanation shown",
    );
    assert(
      document.querySelectorAll("meter").length === 6,
      "Six evidence bars shown",
    );
    assert(
      document.querySelector(".weight-row")?.textContent.includes("1.0%"),
      "Normalized weights preserved in browser",
    );
    assert(
      document.querySelectorAll(".candidates li").length === 8,
      "All eight ranked candidates visible",
    );
    assert(
      document.querySelectorAll("tbody tr").length === 6,
      "Winner comparison includes six gaps",
    );
    assert(
      document.querySelector("details").open === innerWidth >= 768,
      "Breakdown defaults match viewport",
    );
    assert(
      document.querySelectorAll(".spotify-link").length === 8,
      "Every candidate has a Spotify link",
    );
    document.querySelectorAll(".candidate")[2].click();
    await until(() =>
      document.querySelector("caption")?.textContent.includes("Dreams"),
    );
    assert(true, "Candidate selection changes comparison");
    assert(
      !document.querySelector(".selected-comparison button"),
      "Unverified candidate cannot be queued",
    );
    assert(
      document.documentElement.scrollWidth <= innerWidth,
      "No horizontal overflow",
    );
    assert(
      localStorage.length === 0 && sessionStorage.length === 0,
      "Photo flow writes no browser storage",
    );
    button("Try another photo").click();
    await until(() => !document.querySelector(".results"));
    assert(
      button("Find my song").disabled &&
        !document.querySelector(".photo-preview"),
      "Try another photo clears image and result",
    );
    const invalid = new DataTransfer();
    invalid.items.add(new File(["bad"], "bad.txt", { type: "text/plain" }));
    input.files = invalid.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() =>
      document
        .querySelector('[role="alert"]')
        ?.textContent.includes("That file didn't work"),
    );
    assert(true, "Unreadable files show recovery message");
    return {
      passed: checks.length,
      checks,
      viewport: { width: innerWidth, height: innerHeight },
    };
  } finally {
    window.fetch = originalFetch;
  }
})();
