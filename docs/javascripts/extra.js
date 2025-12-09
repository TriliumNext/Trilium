// Custom JavaScript for Trilium Notes documentation

// Add smooth scrolling for anchor links
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for internal links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add copy button to code blocks if not already present
    const codeBlocks = document.querySelectorAll('pre code');
    codeBlocks.forEach(block => {
        if (!block.parentElement.querySelector('.copy-button')) {
            const button = document.createElement('button');
            button.className = 'copy-button';
            button.textContent = 'Copy';
            button.addEventListener('click', () => {
                navigator.clipboard.writeText(block.textContent);
                button.textContent = 'Copied!';
                setTimeout(() => {
                    button.textContent = 'Copy';
                }, 2000);
            });
            block.parentElement.appendChild(button);
        }
    });

    // Add external link indicators
    document.querySelectorAll('a[href^="http"]').forEach(link => {
        if (!link.hostname.includes('trilium')) {
            link.classList.add('external-link');
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
        }
    });

    // Platform detection for download buttons
    const platform = detectPlatform();
    const downloadButtons = document.querySelectorAll('.download-button');
    downloadButtons.forEach(button => {
        if (button.dataset.platform === platform) {
            button.classList.add('recommended');
            button.innerHTML += ' <span class="badge">Recommended</span>';
        }
    });
});

// Detect user's platform
function detectPlatform() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('mac')) return 'macos';
    if (userAgent.includes('linux')) return 'linux';
    return 'unknown';
}

// Add search shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('.md-search__input');
        if (searchInput) {
            searchInput.focus();
        }
    }
});

// Version selector enhancement
const versionSelector = document.querySelector('.md-version__current');
if (versionSelector) {
    // Add version comparison tooltip
    versionSelector.addEventListener('mouseenter', function() {
        const tooltip = document.createElement('div');
        tooltip.className = 'version-tooltip';
        tooltip.textContent = 'Click to view other versions';
        this.appendChild(tooltip);
    });
}

// Analytics event tracking for documentation
if (typeof gtag !== 'undefined') {
    // Track external link clicks
    document.querySelectorAll('a[href^="http"]').forEach(link => {
        link.addEventListener('click', () => {
            gtag('event', 'click', {
                'event_category': 'external_link',
                'event_label': link.href
            });
        });
    });

    // Track code copy events
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', () => {
            gtag('event', 'copy_code', {
                'event_category': 'engagement',
                'event_label': window.location.pathname
            });
        });
    });
}