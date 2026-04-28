// Workaround for Node 21+ incompatibility with Webex SDK trying to set read-only global navigator
if (global.navigator) {
  Object.defineProperty(global, "navigator", {
    value: global.navigator,
    writable: true,
    configurable: true,
  });
}
