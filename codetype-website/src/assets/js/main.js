// Interactive Typing Demo
const demoCode = `function calculateWPM(chars, seconds) {
  const words = chars / 5;
  const minutes = seconds / 60;
  return Math.round(words / minutes);
}

const startTime = Date.now();
let totalChars = 0;
let errors = 0;

document.addEventListener('keydown', (e) => {
  if (isValidKey(e.key)) {
    totalChars++;
    updateStats();
  }
});`;

class TypingDemo {
  constructor() {
    this.container = document.getElementById('typing-demo');
    this.wpmDisplay = document.getElementById('demo-wpm');
    this.accuracyDisplay = document.getElementById('demo-accuracy');
    this.progressDisplay = document.getElementById('demo-progress');

    this.code = demoCode;
    this.currentIndex = 0;
    this.errors = 0;
    this.totalKeystrokes = 0;
    this.startTime = null;
    this.isActive = false;

    this.init();
  }

  init() {
    this.render();
    this.container.parentElement.addEventListener('click', () => this.activate());
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  render() {
    let html = '';
    const lines = this.code.split('\n');

    lines.forEach((line, lineIndex) => {
      html += '<div class="code-line">';
      for (let i = 0; i < line.length; i++) {
        const globalIndex = this.getGlobalIndex(lineIndex, i);
        const char = line[i];
        let className = 'typing-char';

        if (globalIndex < this.currentIndex) {
          className += ' correct';
        } else {
          className += ' untyped';
        }

        // Add cursor after current position
        if (globalIndex === this.currentIndex) {
          html += '<span class="typing-cursor"></span>';
        }

        // Syntax highlighting
        let displayChar = char === ' ' ? '&nbsp;' : this.escapeHtml(char);
        html += `<span class="${className}" data-index="${globalIndex}">${displayChar}</span>`;
      }

      // Add newline marker
      const newlineIndex = this.getGlobalIndex(lineIndex, line.length);
      if (lineIndex < lines.length - 1) {
        if (newlineIndex === this.currentIndex) {
          html += '<span class="typing-cursor"></span>';
        }
        html += `<span class="typing-char ${newlineIndex < this.currentIndex ? 'correct' : 'untyped'}" data-index="${newlineIndex}">&#8629;</span>`;
      }

      html += '</div>';
    });

    this.container.innerHTML = html;
    this.applySyntaxHighlighting();
  }

  getGlobalIndex(lineIndex, charIndex) {
    const lines = this.code.split('\n');
    let index = 0;
    for (let i = 0; i < lineIndex; i++) {
      index += lines[i].length + 1; // +1 for newline
    }
    return index + charIndex;
  }

  applySyntaxHighlighting() {
    const keywords = ['function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'document'];
    const types = ['Math'];
    const functions = ['calculateWPM', 'addEventListener', 'isValidKey', 'updateStats', 'round'];

    const chars = this.container.querySelectorAll('.typing-char');
    let currentWord = '';
    let wordStart = -1;

    chars.forEach((char, i) => {
      const c = char.textContent;
      if (/[a-zA-Z_]/.test(c)) {
        if (wordStart === -1) wordStart = i;
        currentWord += c;
      } else {
        if (currentWord) {
          this.highlightWord(chars, wordStart, currentWord, keywords, types, functions);
        }
        currentWord = '';
        wordStart = -1;

        // Highlight operators and brackets
        if (/[(){}[\];,.]/.test(c)) {
          char.classList.add('operator');
        }
        // Highlight strings
        if (c === "'" || c === '"') {
          char.classList.add('string');
        }
        // Highlight numbers
        if (/[0-9]/.test(c)) {
          char.classList.add('number');
        }
      }
    });

    if (currentWord) {
      this.highlightWord(chars, wordStart, currentWord, keywords, types, functions);
    }
  }

  highlightWord(chars, startIndex, word, keywords, types, functions) {
    let className = '';
    if (keywords.includes(word)) {
      className = 'keyword';
    } else if (types.includes(word)) {
      className = 'type';
    } else if (functions.includes(word)) {
      className = 'function';
    }

    if (className) {
      for (let i = startIndex; i < startIndex + word.length && i < chars.length; i++) {
        chars[i].classList.add(className);
      }
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  activate() {
    if (!this.isActive) {
      this.isActive = true;
      this.container.parentElement.style.outline = '2px solid var(--vscode-accent)';
    }
  }

  deactivate() {
    this.isActive = false;
    this.container.parentElement.style.outline = 'none';
  }

  handleKeydown(e) {
    if (!this.isActive) return;

    // Prevent default for most keys when active
    if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') {
      e.preventDefault();
    }

    // Start timer on first keystroke
    if (!this.startTime && e.key.length === 1) {
      this.startTime = Date.now();
    }

    const expectedChar = this.code[this.currentIndex];

    if (e.key === 'Backspace') {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        this.render();
      }
      return;
    }

    if (e.key === 'Enter') {
      if (expectedChar === '\n') {
        this.totalKeystrokes++;
        this.currentIndex++;
        this.render();
        this.updateStats();
      } else {
        this.errors++;
        this.totalKeystrokes++;
      }
      return;
    }

    // Tab handling
    if (e.key === 'Tab') {
      e.preventDefault();
      // Check for two spaces
      if (this.code.substr(this.currentIndex, 2) === '  ') {
        this.totalKeystrokes++;
        this.currentIndex += 2;
        this.render();
        this.updateStats();
      }
      return;
    }

    if (e.key.length === 1) {
      this.totalKeystrokes++;

      if (e.key === expectedChar) {
        this.currentIndex++;
        this.render();
        this.updateStats();

        // Check if completed
        if (this.currentIndex >= this.code.length) {
          this.complete();
        }
      } else {
        this.errors++;
        this.updateStats();
        // Visual error feedback
        const currentChar = this.container.querySelector(`[data-index="${this.currentIndex}"]`);
        if (currentChar) {
          currentChar.classList.add('incorrect');
          setTimeout(() => currentChar.classList.remove('incorrect'), 200);
        }
      }
    }
  }

  updateStats() {
    if (!this.startTime) return;

    const elapsedMs = Date.now() - this.startTime;
    const elapsedMinutes = elapsedMs / 60000;
    const words = this.currentIndex / 5;
    const wpm = Math.round(words / elapsedMinutes) || 0;

    const accuracy = this.totalKeystrokes > 0
      ? Math.round(((this.totalKeystrokes - this.errors) / this.totalKeystrokes) * 100)
      : 100;

    const progress = Math.round((this.currentIndex / this.code.length) * 100);

    this.wpmDisplay.textContent = wpm;
    this.accuracyDisplay.textContent = accuracy + '%';
    this.progressDisplay.textContent = progress + '%';
  }

  complete() {
    this.deactivate();
    const finalWpm = this.wpmDisplay.textContent;
    const finalAccuracy = this.accuracyDisplay.textContent;

    // Show completion message
    setTimeout(() => {
      alert(`Completed! WPM: ${finalWpm}, Accuracy: ${finalAccuracy}`);
      this.reset();
    }, 100);
  }

  reset() {
    this.currentIndex = 0;
    this.errors = 0;
    this.totalKeystrokes = 0;
    this.startTime = null;
    this.wpmDisplay.textContent = '0';
    this.accuracyDisplay.textContent = '100%';
    this.progressDisplay.textContent = '0%';
    this.render();
  }
}

// FAQ Accordion
class FAQ {
  constructor() {
    this.items = document.querySelectorAll('.faq-item');
    this.init();
  }

  init() {
    this.items.forEach(item => {
      const question = item.querySelector('.faq-question');
      question.addEventListener('click', () => this.toggle(item));
    });
  }

  toggle(item) {
    const wasActive = item.classList.contains('active');

    // Close all items
    this.items.forEach(i => i.classList.remove('active'));

    // Open clicked item if it wasn't active
    if (!wasActive) {
      item.classList.add('active');
    }
  }
}

// Smooth scroll for anchor links
function initSmoothScroll() {
  document.querySelectorAll('a[href*="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const url = new URL(this.getAttribute('href'), window.location.href);
      if (url.pathname !== window.location.pathname || url.hash.length < 2) {
        return;
      }
      const target = document.querySelector(url.hash);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// Activity bar active state
function initActivityBar() {
  const icons = document.querySelectorAll('.activity-icon');
  const sections = ['hero', 'features', 'download', 'faq'];
  const scrollContainer = document.querySelector('.editor-content');

  if (!scrollContainer || icons.length === 0) {
    return;
  }

  const updateActive = () => {
    const scrollPos = scrollContainer.scrollTop + 200;

    sections.forEach((section, index) => {
      const element = document.getElementById(section);
      if (!element) {
        return;
      }
      const top = element.offsetTop;
      const bottom = top + element.offsetHeight;

      if (scrollPos >= top && scrollPos < bottom) {
        icons.forEach(icon => icon.classList.remove('active'));
        icons[index]?.classList.add('active');
      }
    });
  };

  scrollContainer.addEventListener('scroll', updateActive);
  updateActive();
}

// Animate elements on scroll
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card, .pun-card, .download-card, .faq-item').forEach(el => {
    observer.observe(el);
  });
}

// Mobile sidebar toggle
function initSidebarToggle() {
  const toggle = document.querySelector('.sidebar-toggle');
  const overlay = document.querySelector('.sidebar-overlay');
  const shell = document.querySelector('.vscode-window');
  const sidebarLinks = document.querySelectorAll('#sidebar a');

  if (!toggle || !overlay || !shell) {
    return;
  }

  const setOpen = (isOpen) => {
    shell.classList.toggle('sidebar-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  };

  toggle.addEventListener('click', () => {
    setOpen(!shell.classList.contains('sidebar-open'));
  });

  overlay.addEventListener('click', () => setOpen(false));

  sidebarLinks.forEach(link => {
    link.addEventListener('click', () => setOpen(false));
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  });
}

// Breadcrumb and Tab updater
function initBreadcrumbUpdater() {
  const breadcrumb = document.querySelector('.breadcrumb');
  const tabName = document.querySelector('.tab.active span:not(.tab-close)');
  const fileItems = document.querySelectorAll('.file-item');
  const activityIcons = document.querySelectorAll('.activity-icon');

  if (!breadcrumb) return;

  // Map hrefs to breadcrumb labels
  const breadcrumbMap = {
    '/': { crumbs: [{ label: 'codetype', href: '/' }], tab: 'codetype' },
    '/#hero': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'welcome.ts', href: '/#hero' }], tab: 'welcome.ts' },
    '/#features': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'features.ts', href: '/#features' }], tab: 'features.ts' },
    '/#download': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'config.json', href: '/#download' }], tab: 'config.json' },
    '/#opensource': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'README.md', href: '/#opensource' }], tab: 'README.md' },
    '/#faq': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'faq.ts', href: '/#faq' }], tab: 'faq.ts' },
    '/dashboard/': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'user', href: '/dashboard/' }, { label: 'dashboard.ts', href: '/dashboard/' }], tab: 'dashboard.ts' },
    '/leaderboard/': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'user', href: '/dashboard/' }, { label: 'leaderboard.ts', href: '/leaderboard/' }], tab: 'leaderboard.ts' },
    '/auth/login/': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'user', href: '/dashboard/' }, { label: 'login.json', href: '/auth/login/' }], tab: 'login.json' },
    '/privacy/': { crumbs: [{ label: 'codetype', href: '/' }, { label: 'privacy.md', href: '/privacy/' }], tab: 'privacy.md' }
  };

  const updateBreadcrumb = (href) => {
    // Normalize href
    const normalizedHref = href.replace(window.location.origin, '');
    const mapping = breadcrumbMap[normalizedHref] || breadcrumbMap['/#hero'];

    if (!mapping) return;

    // Update breadcrumb HTML
    let html = '';
    mapping.crumbs.forEach((crumb, index) => {
      if (index > 0) {
        html += '<span class="breadcrumb-separator" aria-hidden="true">&gt;</span>';
      }
      const ariaCurrent = index === mapping.crumbs.length - 1 ? ' aria-current="page"' : '';
      html += `<a href="${crumb.href}" class="breadcrumb-link"${ariaCurrent}>${crumb.label}</a>`;
    });
    breadcrumb.innerHTML = html;

    // Update tab name
    if (tabName) {
      tabName.textContent = mapping.tab;
    }

    // Update active state on file items
    fileItems.forEach(item => {
      const itemHref = item.getAttribute('href');
      if (itemHref === normalizedHref || itemHref === href) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  };

  // Add click handlers to file items
  fileItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const href = item.getAttribute('href');
      updateBreadcrumb(href);
    });
  });

  // Add click handlers to activity icons
  activityIcons.forEach(icon => {
    icon.addEventListener('click', (e) => {
      const href = icon.getAttribute('href');
      updateBreadcrumb(href);
    });
  });

  // Update on hash change
  window.addEventListener('hashchange', () => {
    updateBreadcrumb(window.location.pathname + window.location.hash);
  });

  // Set initial breadcrumb based on current URL
  const initialHref = window.location.pathname + window.location.hash;
  if (breadcrumbMap[initialHref]) {
    updateBreadcrumb(initialHref);
  }
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  new TypingDemo();
  new FAQ();
  initSmoothScroll();
  initActivityBar();
  initScrollAnimations();
  initSidebarToggle();
  initBreadcrumbUpdater();
});

// Click outside to deactivate typing demo
document.addEventListener('click', (e) => {
  const demoContainer = document.querySelector('.demo-container');
  if (demoContainer && !demoContainer.contains(e.target)) {
    const demo = document.getElementById('typing-demo');
    if (demo) {
      demo.parentElement.style.outline = 'none';
    }
  }
});
