const { app, dialog } = require('electron');
console.log('in packaged test, dialog:', typeof dialog.showErrorBox);
