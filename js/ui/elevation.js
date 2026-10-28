/* Shelf view. Stub until Phase 4. */
(function (Alpha) {
  'use strict';
  Alpha.elevation = {
    render: function (el, loc, p) {
      el.innerHTML = '<p class="elev-msg">' + (p ? 'Shelf view comes in Phase 4.' : 'Choose a product to see its shelf.') + '</p>';
    }
  };
})(window.Alpha);
