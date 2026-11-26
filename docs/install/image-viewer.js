const viewer = document.querySelector('#image-viewer');
const fullImage = viewer.querySelector('img');
let opener;

for (const link of document.querySelectorAll('figure > a')) {
  link.setAttribute('aria-haspopup', 'dialog');
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    opener = link;
    fullImage.src = link.href;
    fullImage.alt = link.querySelector('img').alt;
    viewer.showModal();
    document.body.classList.add('image-viewer-open');
  });
}
viewer.querySelector('button').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', (event) => {
  const rect = viewer.getBoundingClientRect();
  if (event.target === viewer && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) viewer.close();
});
viewer.addEventListener('close', () => {
  document.body.classList.remove('image-viewer-open');
  fullImage.removeAttribute('src');
  opener?.focus({preventScroll: true});
});
