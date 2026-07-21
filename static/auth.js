/* ============================================================
   MediAssist — Authentication UI helpers
   Handles profile and logout navigation without altering existing chat behavior.
   ============================================================ */
(function () {
  "use strict";

  const profileBtn = document.getElementById("profileBtn");
  const navProfileBtn = document.getElementById("navProfileBtn");
  const navLogoutBtn = document.getElementById("navLogoutBtn");

  if (profileBtn) {
    profileBtn.addEventListener("click", () => {
      window.location.href = "/profile";
    });
  }

  if (navProfileBtn) {
    navProfileBtn.addEventListener("click", () => {
      window.location.href = "/profile";
    });
  }

  if (navLogoutBtn) {
    navLogoutBtn.addEventListener("click", () => {
      window.location.href = "/logout";
    });
  }
})();
