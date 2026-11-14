// Pure geometry for the globe. No three.js here, so the same code runs in node
// for checks. Latitude in degrees (north positive), longitude in degrees
// (east positive).

// three.js builds a sphere with u = 0 at the -x axis and u growing toward +z
// (SphereGeometry). The stitched texture starts at lon -180 on its left edge,
// so u = (lon + 180) / 360. These two functions are exact inverses.
export function dirFromLatLon(lat, lon) {
  const la = (lat * Math.PI) / 180;
  const ps = ((lon + 180) * Math.PI) / 180;
  return [-Math.cos(ps) * Math.cos(la), Math.sin(la), Math.sin(ps) * Math.cos(la)];
}

export function latLonFromDir([x, y, z]) {
  const len = Math.hypot(x, y, z);
  const lat = (Math.asin(y / len) * 180) / Math.PI;
  const lon = (Math.atan2(z, -x) * 180) / Math.PI - 180;
  return { lat, lon: ((lon % 360) + 360) % 360 }; // 0 to 360, east positive
}

// Texture coordinates of a point, as three.js sphere UVs (v = 1 at the north pole).
export function textureUV(lat, lon) {
  const u = ((((lon + 180) % 360) + 360) % 360) / 360;
  return { u, v: (lat + 90) / 180 };
}

// Rotation that turns the globe so (lat, lon) faces the viewer on +z.
// Apply as rotation.y = yaw, rotation.x = pitch (three.js "XYZ" order).
export function facing(lat, lon) {
  const [x, y, z] = dirFromLatLon(lat, lon);
  const yaw = Math.PI / 2 - ((lon + 180) * Math.PI) / 180;
  const pitch = Math.atan2(y, Math.hypot(x, z));
  return { yaw, pitch };
}

// MOLA grid: 1440 x 720 cells of 0.25 degree, row 0 at 90 N, column 0 at 0 E.
// Returns the cell value in metres, or null for a missing grid.
export function molaAt(grid, lat, lon) {
  if (!grid) return null;
  const col = Math.floor((((lon % 360) + 360) % 360) * 4) % 1440;
  const row = Math.min(719, Math.max(0, Math.floor((90 - lat) * 4)));
  return grid[row * 1440 + col];
}

// Reads the stored little-endian int16 file regardless of the machine's byte order.
export function parseMola(buffer) {
  const view = new DataView(buffer);
  const out = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}
