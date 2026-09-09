import { MOBILE_MQ } from "./tweaks.js";
import { initWorksFeed } from "./works-feed.js";

/* The slider CSS keys off `html.is-mobile` (set by the deck on `/`); mirror it here. */
const mobile = window.matchMedia(MOBILE_MQ);
function syncMobile() {
  document.documentElement.classList.toggle("is-mobile", mobile.matches);
}
syncMobile();
mobile.addEventListener("change", syncMobile);

initWorksFeed();
