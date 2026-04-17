const { openCodeContext } = require('./server/codeContext.js');
openCodeContext({ 
  repo: "/Users/kafaz/dev/repos/fio", 
  branch: "master", 
  commit: "306d89868d07b98d1683585468d232703007e0da" 
}).then(console.log).catch(console.error);
