/* Settings. Minimal until Phase 5: first basket scheme, all rules on. */
(function (Alpha) {
  'use strict';
  Alpha.settings = {
    init: function () {},
    scheme: function (ds) { return (ds.basketSchemes || [])[0] || null; },
    disabledRules: function () { return {}; },
    importedDataset: function () { return null; }
  };
})(window.Alpha);
