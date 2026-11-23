'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { packH5PPackage } = require('./h5pPacker');

(async () => {
  try {
    const activityType = workerData.activityType || 'questionset';
    const items = workerData.items !== undefined ? workerData.items : workerData.questions;
    const { bytes } = await packH5PPackage(activityType, items, {
      title: workerData.title
    });
    parentPort.postMessage({ bytes });
  } catch {
    parentPort.postMessage({ error: true });
  }
})();
