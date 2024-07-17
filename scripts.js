// Function to toggle sections
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    const parent = section.parentElement;

    if (section.style.display === 'none' || section.style.display === '') {
        section.style.display = 'block';
        parent.classList.add('open');
    } else {
        section.style.display = 'none';
        parent.classList.remove('open');
    }
}

// Function for search
document.getElementById('search-input').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    const elements = document.querySelectorAll('.content .toggle-content');

    elements.forEach(element => {
        element.style.display = 'none';
        element.parentElement.classList.remove('open');
    });

    elements.forEach(element => {
        if (element.parentElement.textContent.toLowerCase().includes(query)) {
            element.style.display = 'block';
            element.parentElement.classList.add('open');
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
    const iframe = document.getElementById('dexscreener-iframe');
    const isVisible = embedContainer.style.display === 'block';

    embedContainer.style.display = isVisible ? 'none' : 'block';
    
    if (!isVisible) {
        setTimeout(() => {
            iframe.contentWindow.postMessage('selectChartTab', '*');
        }, 1000);
    }
});

window.addEventListener('message', (event) => {
    if (event.data === 'selectChartTab') {
        const chartButton = document.querySelector('button[aria-label="Chart"]');
        if (chartButton) {
            chartButton.click();
        }
    }
});
