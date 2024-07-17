// Funcția pentru toggle a secțiunilor
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    section.style.display = (section.style.display === 'none' || section.style.display === '') ? 'block' : 'none';
}

// Funcția pentru căutare
document.getElementById('search-input').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    const elements = document.querySelectorAll('.content .toggle-content');

    elements.forEach(element => {
        element.style.display = 'none';
    });

    elements.forEach(element => {
        if (element.parentElement.textContent.toLowerCase().includes(query)) {
            element.style.display = 'block';
        }
    });
});

// Function to reload the iframe with the appropriate tab
function loadDexScreenerIframe() {
    const iframe = document.getElementById('dexscreener-iframe');
    iframe.src = 'https://dexscreener.com/multiversx/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff?embed=1&theme=dark&tab=chart';
}

// Toggle DexScreener embed visibility
document.getElementById('toggle-dexscreener').addEventListener('click', function() {
    const embedContainer = document.getElementById('dexscreener-embed-container');
    const isVisible = embedContainer.style.display === 'block';
    
    embedContainer.style.display = isVisible ? 'none' : 'block';
    
    if (!isVisible) {
        loadDexScreenerIframe();
    }
});
