/**
 * Camera injection utilities
 * Builds scripts for camera access injection
 */

export interface CameraConfig {
  enabled: boolean
  resolution: string
  fps: number
  audioEnabled: boolean
  sourceUrl?: string
}

export const DEFAULT_CONFIG: CameraConfig = {
  enabled: false,
  resolution: '1280x720',
  fps: 30,
  audioEnabled: false
}

export function buildCameraScript(config: CameraConfig): string {
  return `
    (function() {
      const config = ${JSON.stringify(config)};
      if (!config.enabled) return;
      
      console.log('Camera injection enabled:', config);
      // TODO: Implement actual camera injection logic
    })();
  `;
}

export function buildPatchScript(): string {
  return `
    (function() {
      // Patch getUserMedia to inject camera
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = function(constraints) {
        console.log('getUserMedia called with:', constraints);
        return originalGetUserMedia.call(this, constraints);
      };
    })();
  `;
}

export function buildDisableScript(): string {
  return `
    (function() {
      // Disable camera injection
      console.log('Camera injection disabled');
    })();
  `;
}
