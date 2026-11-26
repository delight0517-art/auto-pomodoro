function shouldApplyLoginItemSettings(platform, argv = []) {
  if (platform === 'linux') return false;
  return !argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='));
}

module.exports = { shouldApplyLoginItemSettings };
