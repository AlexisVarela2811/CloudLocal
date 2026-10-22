const { execSync } = require('child_process');

try {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  const lines = out.split('\n')
    .filter(l => l.includes(':80') && l.includes('LISTENING'));
  
  if (lines.length > 0) {
    const match = lines[0].match(/\s+(\d+)\s*$/);
    if (match) {
      const pid = match[1];
      console.log('Killing CloudLocal.exe (PID', pid + ')');
      execSync('taskkill /F /PID ' + pid, { stdio: 'inherit' });
      setTimeout(() => {
        console.log('Killed. Ready to rebuild.');
        process.exit(0);
      }, 2000);
    } else {
      console.log('Could not extract PID from:', lines[0]);
      process.exit(1);
    }
  } else {
    console.log('CloudLocal.exe not running on port 80');
    process.exit(0);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}