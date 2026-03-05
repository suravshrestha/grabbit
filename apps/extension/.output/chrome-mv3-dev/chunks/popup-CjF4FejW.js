(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
function print(method, ...args) {
  if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
  else method("[wxt]", ...args);
}
const logger = {
  debug: (...args) => print(console.debug, ...args),
  log: (...args) => print(console.log, ...args),
  warn: (...args) => print(console.warn, ...args),
  error: (...args) => print(console.error, ...args)
};
let ws;
function getDevServerWebSocket() {
  if (ws == null) {
    const serverUrl = "ws://localhost:3000";
    logger.debug("Connecting to dev server @", serverUrl);
    ws = new WebSocket(serverUrl, "vite-hmr");
    ws.addWxtEventListener = ws.addEventListener.bind(ws);
    ws.sendCustom = (event, payload) => ws == null ? void 0 : ws.send(JSON.stringify({
      type: "custom",
      event,
      payload
    }));
    ws.addEventListener("open", () => {
      logger.debug("Connected to dev server");
    });
    ws.addEventListener("close", () => {
      logger.debug("Disconnected from dev server");
    });
    ws.addEventListener("error", (event) => {
      logger.error("Failed to connect to dev server", event);
    });
    ws.addEventListener("message", (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message.type === "custom") ws == null ? void 0 : ws.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
      } catch (err) {
        logger.error("Failed to handle message", err);
      }
    });
  }
  return ws;
}
try {
  getDevServerWebSocket().addWxtEventListener("wxt:reload-page", (event) => {
    if (event.detail === location.pathname.substring(1)) location.reload();
  });
} catch (err) {
  logger.error("Failed to setup web socket connection with dev server", err);
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9wdXAtQ2pGNEZlalcuanMiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS93eHRAMC4yMC4xOF9AdHlwZXMrbm9kZUAyMi4xOS4xM19lc2xpbnRAOS4zOS4zX2ppdGlAMi42LjFfX2ppdGlAMi42LjFfcm9sbHVwQDQuNTkuMF90c3hANC4yMS4wX3lhbWxAMi44LjIvbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3ZpcnR1YWwvcmVsb2FkLWh0bWwubWpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvbG9nZ2VyLnRzXG5mdW5jdGlvbiBwcmludChtZXRob2QsIC4uLmFyZ3MpIHtcblx0aWYgKGltcG9ydC5tZXRhLmVudi5NT0RFID09PSBcInByb2R1Y3Rpb25cIikgcmV0dXJuO1xuXHRpZiAodHlwZW9mIGFyZ3NbMF0gPT09IFwic3RyaW5nXCIpIG1ldGhvZChgW3d4dF0gJHthcmdzLnNoaWZ0KCl9YCwgLi4uYXJncyk7XG5cdGVsc2UgbWV0aG9kKFwiW3d4dF1cIiwgLi4uYXJncyk7XG59XG4vKipcbiogV3JhcHBlciBhcm91bmQgYGNvbnNvbGVgIHdpdGggYSBcIlt3eHRdXCIgcHJlZml4XG4qL1xuY29uc3QgbG9nZ2VyID0ge1xuXHRkZWJ1ZzogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUuZGVidWcsIC4uLmFyZ3MpLFxuXHRsb2c6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmxvZywgLi4uYXJncyksXG5cdHdhcm46ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLndhcm4sIC4uLmFyZ3MpLFxuXHRlcnJvcjogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUuZXJyb3IsIC4uLmFyZ3MpXG59O1xuXG4vLyNlbmRyZWdpb25cbi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvZGV2LXNlcnZlci13ZWJzb2NrZXQudHNcbmxldCB3cztcbi8qKlxuKiBDb25uZWN0IHRvIHRoZSB3ZWJzb2NrZXQgYW5kIGxpc3RlbiBmb3IgbWVzc2FnZXMuXG4qL1xuZnVuY3Rpb24gZ2V0RGV2U2VydmVyV2ViU29ja2V0KCkge1xuXHRpZiAoaW1wb3J0Lm1ldGEuZW52LkNPTU1BTkQgIT09IFwic2VydmVcIikgdGhyb3cgRXJyb3IoXCJNdXN0IGJlIHJ1bm5pbmcgV1hUIGRldiBjb21tYW5kIHRvIGNvbm5lY3QgdG8gY2FsbCBnZXREZXZTZXJ2ZXJXZWJTb2NrZXQoKVwiKTtcblx0aWYgKHdzID09IG51bGwpIHtcblx0XHRjb25zdCBzZXJ2ZXJVcmwgPSBfX0RFVl9TRVJWRVJfT1JJR0lOX187XG5cdFx0bG9nZ2VyLmRlYnVnKFwiQ29ubmVjdGluZyB0byBkZXYgc2VydmVyIEBcIiwgc2VydmVyVXJsKTtcblx0XHR3cyA9IG5ldyBXZWJTb2NrZXQoc2VydmVyVXJsLCBcInZpdGUtaG1yXCIpO1xuXHRcdHdzLmFkZFd4dEV2ZW50TGlzdGVuZXIgPSB3cy5hZGRFdmVudExpc3RlbmVyLmJpbmQod3MpO1xuXHRcdHdzLnNlbmRDdXN0b20gPSAoZXZlbnQsIHBheWxvYWQpID0+IHdzPy5zZW5kKEpTT04uc3RyaW5naWZ5KHtcblx0XHRcdHR5cGU6IFwiY3VzdG9tXCIsXG5cdFx0XHRldmVudCxcblx0XHRcdHBheWxvYWRcblx0XHR9KSk7XG5cdFx0d3MuYWRkRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgKCkgPT4ge1xuXHRcdFx0bG9nZ2VyLmRlYnVnKFwiQ29ubmVjdGVkIHRvIGRldiBzZXJ2ZXJcIik7XG5cdFx0fSk7XG5cdFx0d3MuYWRkRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsICgpID0+IHtcblx0XHRcdGxvZ2dlci5kZWJ1ZyhcIkRpc2Nvbm5lY3RlZCBmcm9tIGRldiBzZXJ2ZXJcIik7XG5cdFx0fSk7XG5cdFx0d3MuYWRkRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIChldmVudCkgPT4ge1xuXHRcdFx0bG9nZ2VyLmVycm9yKFwiRmFpbGVkIHRvIGNvbm5lY3QgdG8gZGV2IHNlcnZlclwiLCBldmVudCk7XG5cdFx0fSk7XG5cdFx0d3MuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgKGUpID0+IHtcblx0XHRcdHRyeSB7XG5cdFx0XHRcdGNvbnN0IG1lc3NhZ2UgPSBKU09OLnBhcnNlKGUuZGF0YSk7XG5cdFx0XHRcdGlmIChtZXNzYWdlLnR5cGUgPT09IFwiY3VzdG9tXCIpIHdzPy5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChtZXNzYWdlLmV2ZW50LCB7IGRldGFpbDogbWVzc2FnZS5kYXRhIH0pKTtcblx0XHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0XHRsb2dnZXIuZXJyb3IoXCJGYWlsZWQgdG8gaGFuZGxlIG1lc3NhZ2VcIiwgZXJyKTtcblx0XHRcdH1cblx0XHR9KTtcblx0fVxuXHRyZXR1cm4gd3M7XG59XG5cbi8vI2VuZHJlZ2lvblxuLy8jcmVnaW9uIHNyYy92aXJ0dWFsL3JlbG9hZC1odG1sLnRzXG5pZiAoaW1wb3J0Lm1ldGEuZW52LkNPTU1BTkQgPT09IFwic2VydmVcIikgdHJ5IHtcblx0Z2V0RGV2U2VydmVyV2ViU29ja2V0KCkuYWRkV3h0RXZlbnRMaXN0ZW5lcihcInd4dDpyZWxvYWQtcGFnZVwiLCAoZXZlbnQpID0+IHtcblx0XHRpZiAoZXZlbnQuZGV0YWlsID09PSBsb2NhdGlvbi5wYXRobmFtZS5zdWJzdHJpbmcoMSkpIGxvY2F0aW9uLnJlbG9hZCgpO1xuXHR9KTtcbn0gY2F0Y2ggKGVycikge1xuXHRsb2dnZXIuZXJyb3IoXCJGYWlsZWQgdG8gc2V0dXAgd2ViIHNvY2tldCBjb25uZWN0aW9uIHdpdGggZGV2IHNlcnZlclwiLCBlcnIpO1xufVxuXG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7ICB9OyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsU0FBUyxNQUFNLFdBQVcsTUFBTTtBQUUvQixNQUFJLE9BQU8sS0FBSyxDQUFDLE1BQU0sU0FBVSxRQUFPLFNBQVMsS0FBSyxNQUFBLENBQU8sSUFBSSxHQUFHLElBQUk7QUFBQSxNQUNuRSxRQUFPLFNBQVMsR0FBRyxJQUFJO0FBQzdCO0FBSUEsTUFBTSxTQUFTO0FBQUEsRUFDZCxPQUFPLElBQUksU0FBUyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUk7QUFBQSxFQUNoRCxLQUFLLElBQUksU0FBUyxNQUFNLFFBQVEsS0FBSyxHQUFHLElBQUk7QUFBQSxFQUM1QyxNQUFNLElBQUksU0FBUyxNQUFNLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBQSxFQUM5QyxPQUFPLElBQUksU0FBUyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUk7QUFDakQ7QUFJQSxJQUFJO0FBSUosU0FBUyx3QkFBd0I7QUFFaEMsTUFBSSxNQUFNLE1BQU07QUFDZixVQUFNLFlBQVk7QUFDbEIsV0FBTyxNQUFNLDhCQUE4QixTQUFTO0FBQ3BELFNBQUssSUFBSSxVQUFVLFdBQVcsVUFBVTtBQUN4QyxPQUFHLHNCQUFzQixHQUFHLGlCQUFpQixLQUFLLEVBQUU7QUFDcEQsT0FBRyxhQUFhLENBQUMsT0FBTyxZQUFZLHlCQUFJLEtBQUssS0FBSyxVQUFVO0FBQUEsTUFDM0QsTUFBTTtBQUFBLE1BQ047QUFBQSxNQUNBO0FBQUEsSUFBQSxDQUNBO0FBQ0QsT0FBRyxpQkFBaUIsUUFBUSxNQUFNO0FBQ2pDLGFBQU8sTUFBTSx5QkFBeUI7QUFBQSxJQUN2QyxDQUFDO0FBQ0QsT0FBRyxpQkFBaUIsU0FBUyxNQUFNO0FBQ2xDLGFBQU8sTUFBTSw4QkFBOEI7QUFBQSxJQUM1QyxDQUFDO0FBQ0QsT0FBRyxpQkFBaUIsU0FBUyxDQUFDLFVBQVU7QUFDdkMsYUFBTyxNQUFNLG1DQUFtQyxLQUFLO0FBQUEsSUFDdEQsQ0FBQztBQUNELE9BQUcsaUJBQWlCLFdBQVcsQ0FBQyxNQUFNO0FBQ3JDLFVBQUk7QUFDSCxjQUFNLFVBQVUsS0FBSyxNQUFNLEVBQUUsSUFBSTtBQUNqQyxZQUFJLFFBQVEsU0FBUyxTQUFVLDBCQUFJLGNBQWMsSUFBSSxZQUFZLFFBQVEsT0FBTyxFQUFFLFFBQVEsUUFBUSxLQUFBLENBQU07QUFBQSxNQUN6RyxTQUFTLEtBQUs7QUFDYixlQUFPLE1BQU0sNEJBQTRCLEdBQUc7QUFBQSxNQUM3QztBQUFBLElBQ0QsQ0FBQztBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1I7QUFJeUMsSUFBSTtBQUM1QywwQkFBd0Isb0JBQW9CLG1CQUFtQixDQUFDLFVBQVU7QUFDekUsUUFBSSxNQUFNLFdBQVcsU0FBUyxTQUFTLFVBQVUsQ0FBQyxZQUFZLE9BQUE7QUFBQSxFQUMvRCxDQUFDO0FBQ0YsU0FBUyxLQUFLO0FBQ2IsU0FBTyxNQUFNLHlEQUF5RCxHQUFHO0FBQzFFOyIsInhfZ29vZ2xlX2lnbm9yZUxpc3QiOlswXX0=
