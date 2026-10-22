(function(root){
  'use strict';
  // Separate Worker: the existing login/work service is not redeployed.
  root.BazInspectionQrConfig = Object.freeze({
    api: 'https://baz-inspection-qr.coaptation.workers.dev',
    defaultMinutes: 30
  });
})(window);
