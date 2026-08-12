const MODES = [
  'sword',
  'speed',
  'pot',
  'nethop',
  'ogvanilla',
  'smp',
  'mace',
  'crystal',
  'axe',
  'uhc'
];

const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
const REGIONS = ['eu', 'na', 'au', 'as'];
const QUEUE_LIMIT = 20;

const TIER_POINTS = Object.fromEntries(TIERS.map((tier, index) => [tier, TIERS.length - index]));

const MODE_LABELS = {
  sword: 'Sword',
  speed: 'Speed',
  pot: 'Pot',
  nethop: 'NethOP',
  ogvanilla: 'OG Vanilla',
  smp: 'SMP',
  mace: 'Mace',
  crystal: 'Crystal',
  axe: 'Axe',
  uhc: 'UHC'
};

const REGION_LABELS = {
  eu: 'EU',
  na: 'NA',
  au: 'AU',
  as: 'AS'
};

module.exports = {
  MODES,
  TIERS,
  REGIONS,
  QUEUE_LIMIT,
  TIER_POINTS,
  MODE_LABELS,
  REGION_LABELS
};
