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

// Function to simulate a click on the Chart button inside the iframe
function clickChartButtonInIframe() {
    const iframe = document.querySelector('#dexscreener-embed iframe');
    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
    
    iframe.onload = function() {
        setTimeout(() => {
            const chartButton = iframeDocument.querySelector('button[aria-label="Chart"]');
            if (chartButton) {
                chartButton.click();
            }
        }, 1000); // Adjust the timeout as necessary
    };
}

// Toggle DexScreener embed visibility
document.getElementById('toggle-dexscreener').addEventListener('click', function() {
    const embedContainer = document.getElementById('dexscreener-embed-container');
    embedContainer.style.display = (embedContainer.style.display === 'none' || embedContainer.style.display === '') ? 'block' : 'none';
});

