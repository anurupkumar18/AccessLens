import { PageContext } from './pageContext';

const MAX_CHARS = 6000;

export function isCanvasPage(): boolean {
  return window.location.hostname.endsWith('instructure.com') ||
         document.querySelector('.ic-app') !== null;
}

export function readCanvasContext(defaultSelection: string): PageContext {
  const selection = (window.getSelection()?.toString() ?? defaultSelection ?? '').trim().replace(/\s+/g, ' ');

  // Canvas stores main content usually inside specific containers
  let mainContent: Element | null = null;

  // Try to find specific Canvas content areas
  const contentSelectors = [
    '#content', // Canvas classic main content wrapper
    '.user_content', // Rich text editor output
    '.assignment-description',
    '#syllabusContainer'
  ];

  for (const selector of contentSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      mainContent = el;
      break;
    }
  }

  // Fallback to body if we can't find a canvas-specific container
  mainContent = mainContent ?? document.querySelector('main') ?? document.body;

  // We want to extract text but explicitly skip Canvas navigation / grading chrome
  const skipSelectors = [
    '#application', '#header', '#left-side', '#right-side', // Sidebar & Top Nav
    '.grading_box', '.rubric_table', // Grading UI
    'script', 'style', 'noscript', 'iframe'
  ];

  let textContent = '';
  if (selection) {
    textContent = selection;
  } else {
    // Clone node to manipulate and strip unwanted elements
    const clone = mainContent.cloneNode(true) as HTMLElement;
    
    skipSelectors.forEach(selector => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    // Strip aria-hidden elements
    const hiddenElements = clone.querySelectorAll('[aria-hidden="true"]');
    hiddenElements.forEach(el => el.remove());

    textContent = (clone.textContent ?? '').trim().replace(/\s+/g, ' ');
  }

  return {
    title: document.title,
    url: `${location.origin}${location.pathname}`,
    selection,
    text: textContent.slice(0, MAX_CHARS),
    fromSelection: selection.length > 0,
  };
}
