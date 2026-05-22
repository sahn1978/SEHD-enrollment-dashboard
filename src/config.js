// =============================================================
// Admin protection
// =============================================================
// SHA-256 hash (hex) of the password required to access the
// "Add New Snapshot" and "Snapshot Archive" sections.
//
// To generate your own hash:
//   node scripts/hash-password.js YOUR_PASSWORD
// Then paste the printed hash here as the value below.
//
// If left as an empty string, admin features are HIDDEN from
// everyone (no upload UI, no delete buttons). The dashboard is
// purely read only. Use this for fully public deployments.
//
// Important security note:
//   This gate is client side only. It prevents casual tampering
//   but does not stop a determined viewer with browser dev tools.
//   Do not rely on this for protecting sensitive data.
// =============================================================
export const SITE_PASSWORD_HASH = '3a2922d56f4e474a8b257c50992c957452c7cf643dd6d8f30d04a57f2c25a283'
export const ADMIN_PASSWORD_HASH = '3a2922d56f4e474a8b257c50992c957452c7cf643dd6d8f30d04a57f2c25a283'
