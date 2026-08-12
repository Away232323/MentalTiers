const MODES = ['sword', 'axe', 'smp', 'uhc', 'crystal', 'mace'];
const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];

const TIER_POINTS = Object.fromEntries(TIERS.map((tier, index) => [tier, TIERS.length - index]));

const MODE_LABELS = {
  sword: 'Sword',
  axe: 'Axe',
  smp: 'SMP',
  uhc: 'UHC',
  crystal: 'Crystal',
  mace: 'Mace'
};

module.exports = { MODES, TIERS, TIER_POINTS, MODE_LABELS };
