'use strict';

//part 1. activating/deactivating the debugger via the extension action button.
const STORAGE_KEY = 'activeTabs';
const activeTabs = new Set();
let activeTabsHydrated = false;

function tabStorageKey(tabId) {
  return `${STORAGE_KEY}.${tabId}`;
}

async function hydrateActiveTabs() {
  if (activeTabsHydrated)
    return;

  const data = await chrome.storage.session.get(null);
  for (const key in data) {
    if (key.startsWith(`${STORAGE_KEY}.`))
      activeTabs.add(Number(key.slice(STORAGE_KEY.length + 1)));
  }
  activeTabsHydrated = true;
}

async function setTabActive(tabId, active) {
  await hydrateActiveTabs();

  const key = tabStorageKey(tabId);
  if (active) {
    activeTabs.add(tabId);
    await chrome.storage.session.set({[key]: true});
  } else {
    activeTabs.delete(tabId);
    await chrome.storage.session.remove(key);
  }
  await updateIcon(tabId, active);
}

async function isTabActive(tabId) {
  await hydrateActiveTabs();
  return activeTabs.has(tabId);
}

async function updateIcon(tabId, active) {
  if (active === undefined)
    active = await isTabActive(tabId);

  const color = active ? 'red' : 'black';
  try {
    await chrome.action.setIcon({
      tabId: tabId,
      path: {
        16: `images/${color}_16.png`,
        32: `images/${color}_32.png`
      }
    });
  } catch (error) {
    console.warn("failed to update icon for tab: " + tabId, error.message);
  }
}

async function attachTab(tabId) {
  try {
    await chrome.debugger.attach({tabId: tabId}, "1.3");
    console.log("attached debugger to tab: " + tabId);
    await setTabActive(tabId, true);
  } catch (error) {
    console.warn("failed to attach debugger to tab: " + tabId, error.message);
    await setTabActive(tabId, false);
  }
}

async function detachTab(tabId) {
  try {
    await chrome.debugger.detach({tabId: tabId});
    console.log("detached debugger to tab: " + tabId);
  } catch (error) {
    console.warn("failed to detach debugger from tab: " + tabId, error.message);
  }
  await setTabActive(tabId, false);
}

chrome.action.onClicked.addListener(async function callback(tab) {
  console.log("Action icon clicked. Attaching/detaching the tab.");
  const tabId = tab && tab.id;
  if (typeof tabId !== 'number')
    return;
  const active = await isTabActive(tabId);
  await (active ? detachTab(tabId) : attachTab(tabId));
});

chrome.tabs.onActivated.addListener(async function callback(data) {
  // console.log("A tab activated. Updating icon.");
  await updateIcon(data.tabId);
});

chrome.tabs.onUpdated.addListener(async function callback(tabId) {
  // Chrome can reset the per-tab action icon during reload/navigation.
  await updateIcon(tabId);
});

chrome.debugger.onDetach.addListener(async function callback(source) {
  if (source && typeof source.tabId === 'number')
    await setTabActive(source.tabId, false);
});

chrome.runtime.onMessage.addListener(function handleMessage(request, sender) {
  //filtering out inactive tabs
  var tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number')
    return;
  isTabActive(tabId).then(async function (active) {
    if (active) {
      console.log("received request from clientScript on active tab", request);
      await dispatchNativeEvent(request, tabId);
    }
  }).catch(function (error) {
    console.warn("failed to handle message", request, error.message);
  });
});

//part 2. turning messages into native events for active tabs.
async function dispatchNativeEvent(event, tabId) {
  //convert the command into an approved native event here.
  let cmd;
  if (event.type.startsWith("mouse"))
    cmd = "Input.dispatchMouseEvent";
  else if (event.type.startsWith("touch"))
    cmd = "Input.dispatchTouchEvent";
  else if (event.type === "keyDown" || event.type === "keyUp" || event.type === "char" || event.type === "rawKeyDown")
    cmd = "Input.dispatchKeyEvent";
  else if (event.type === "beforeinput-is-trusted")
    cmd = "Input.insertText";
  else
    throw new Error("Illegal native event: " + event.type);
  try {
    await chrome.debugger.sendCommand({tabId: tabId}, cmd, event);
    console.log("sendCommand", cmd, event);
  } catch (error) {
    console.warn("sendCommand failed", cmd, event, error.message);
    await setTabActive(tabId, false);
  }
}
