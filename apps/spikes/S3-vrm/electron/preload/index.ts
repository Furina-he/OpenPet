// S3 is a pure rendering spike — no Node capability is exposed to the renderer.
// This file exists only to satisfy the BrowserWindow preload path under
// sandbox + contextIsolation. VRM loading happens entirely in the renderer.
export {};
