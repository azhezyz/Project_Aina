// Render an attributed Google map in an isolated browser with a private debugging pipe.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {once} = require("node:events");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function capture({host, bounds, lang, width = 1024, height = 1280, labels = {}}, executable) {
  if (!["127.0.0.1:5173", "localhost:5173"].includes(host)) throw new Error("Invalid local host");
  const temp = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(temp, "aina-roadmap-"));
  const chrome = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", "--enable-unsafe-swiftshader",
    "--remote-debugging-pipe", "--user-data-dir=" + profile, "about:blank"],
    {windowsHide:true, stdio:["ignore","ignore","ignore","pipe","pipe"]});
  const exit = once(chrome, "exit").catch(() => {});
  let sequence = 0, buffer = "", session;
  const pending = new Map();
  function call(method, params = {}, sessionId = session) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      chrome.stdio[3].write(JSON.stringify({id, method, params, sessionId}) + "\0");
    });
  }
  chrome.stdio[4].setEncoding("utf8");
  chrome.stdio[4].on("data", part => {
    buffer += part;
    let end;
    while ((end = buffer.indexOf("\0")) !== -1) {
      const packet = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const op = pending.get(packet.id);
      if (!op) continue;
      pending.delete(packet.id);
      if (packet.error) op.reject(new Error("Browser operation failed"));
      else op.resolve(packet.result);
    }
  });
  exit.then(() => {
    for (const op of pending.values()) op.reject(new Error("Browser exited"));
    pending.clear();
  });
  const timeout = setTimeout(() => chrome.kill(), 37000);
  try {
    const {targetId} = await call("Target.createTarget", {url:"about:blank"});
    session = (await call("Target.attachToTarget", {targetId, flatten:true})).sessionId;
    await call("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor:1, mobile:false});
    await call("Page.navigate", {url:"http://" + host + "/art-capture.html?lang=" + (lang === "en" ? "en" : "zh-CN")});
    for (let i = 0; i < 80; i++) {
      const ready = await call("Runtime.evaluate", {expression:"typeof window.renderKyotoRoadmap === 'function'"});
      if (ready.result.value) break;
      await sleep(80);
    }
    const rendered = await call("Runtime.evaluate", {
      expression:"window.renderKyotoRoadmap(" + JSON.stringify(bounds) + "," + JSON.stringify(labels) + ")", awaitPromise:true, returnByValue:true});
    if (rendered.exceptionDetails || !rendered.result?.value) throw new Error("Map failed");
    const screenshot = async clip => {
      const {data} = await call("Page.captureScreenshot", {format:"png", clip:{...clip, scale:1}});
      return "data:image/png;base64," + data;
    };
    const image = await screenshot({x:0, y:0, width, height});
    const creditImage = await screenshot({x:0, y:height-38, width, height:38});
    return {image, creditImage, creditText:rendered.result.value};
  } finally {
    clearTimeout(timeout);
    chrome.kill();
    await exit;
    if (path.dirname(path.resolve(profile)) === temp && path.basename(profile).startsWith("aina-roadmap-")) {
      try { fs.rmSync(profile, {recursive:true, force:true, maxRetries:4, retryDelay:150}); } catch { /* Chrome may still be closing. */ }
    }
  }
}
capture(JSON.parse(fs.readFileSync(0, "utf8")), process.argv[2])
  .then(data => process.stdout.write(JSON.stringify(data)))
  .catch(() => { process.exitCode = 1; });
