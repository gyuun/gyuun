const hero = document.querySelector('.hero');
const identity = document.querySelector('.hero-identity');
const eyebrow = identity.querySelector('.eyebrow');
const heading = identity.querySelector('h1');
const korean = heading.querySelector('.name-ko');
const english = heading.querySelector('.name-en');
const nameRow = identity.querySelector('.hero-name-row');
const role = identity.querySelector('.hero-role');
const portrait = hero.querySelector('.hero-portrait');

function positionPortrait() {
  const heroBounds = hero.getBoundingClientRect();
  const eyebrowBounds = eyebrow.getBoundingClientRect();
  let koreanBounds = korean.getBoundingClientRect();
  let englishBounds = english.getBoundingClientRect();
  const compact = window.innerWidth <= 760;
  const style = getComputedStyle(heading);
  const fontSize = parseFloat(style.fontSize);
  const nameHeight = heading.getBoundingClientRect().height;
  const diameter = Math.max(koreanBounds.bottom, englishBounds.bottom) - eyebrowBounds.top;
  const nameWidth = koreanBounds.width + englishBounds.width + parseFloat(style.columnGap);
  const gap = 16;
  const roleWidth = compact ? 0 : role.getBoundingClientRect().width + parseFloat(getComputedStyle(nameRow).columnGap);

  // Keep the portrait's existing size calculation and fit the full row within
  // the hero. On small screens the role moves below the names.
  const rightEdge = compact ? identity.getBoundingClientRect().right : heroBounds.right;
  const available = rightEdge - koreanBounds.left - roleWidth - gap - (diameter - nameHeight);
  const fittedSize = available / (nameWidth / fontSize + nameHeight / fontSize);
  if (fittedSize < fontSize - .1) {
    heading.style.setProperty('--portrait-name-size', `${Math.max(1, fittedSize)}px`);
    koreanBounds = korean.getBoundingClientRect();
    englishBounds = english.getBoundingClientRect();
  }

  const fittedDiameter = Math.max(koreanBounds.bottom, englishBounds.bottom) - eyebrowBounds.top;
  const anchorRight = compact ? englishBounds.right : role.getBoundingClientRect().right;
  const centerX = anchorRight + gap + fittedDiameter / 2;
  portrait.style.setProperty('--portrait-center', `${centerX - heroBounds.left}px`);
  portrait.style.setProperty('--portrait-top', `${eyebrowBounds.top - heroBounds.top}px`);
  portrait.style.setProperty('--portrait-diameter', `${fittedDiameter}px`);
  portrait.dataset.layout = compact ? 'beside-name' : 'beside-role';
  portrait.setAttribute('data-positioned', '');
}

function resetPortraitLayout() {
  heading.style.removeProperty('--portrait-name-size');
  positionPortrait();
}

const observer = new ResizeObserver(positionPortrait);
for (const element of [hero, identity, eyebrow, heading, nameRow, role]) observer.observe(element);
window.addEventListener('resize', resetPortraitLayout);
document.fonts.ready.then(resetPortraitLayout);
document.fonts.addEventListener('loadingdone', resetPortraitLayout);
positionPortrait();
