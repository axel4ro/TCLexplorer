// Function to toggle sections
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    section.style.display = (section.style.display === 'none' || section.style.display === '') ? 'block' : 'none';
}

// Function to highlight search terms
function highlight(text) {
    removeHighlights();
    if (text) {
        const elements = document.querySelectorAll('.content .toggle-content, .content .toggle-section');
        const searchRegExp = new RegExp(text, 'gi');
        elements.forEach(element => {
            if (element.textContent.toLowerCase().includes(text.toLowerCase())) {
                element.innerHTML = element.innerHTML.replace(searchRegExp, match => `<span class="highlight">${match}</span>`);
            }
        });
    }
}

// Function to remove highlights
function removeHighlights() {
    const elements = document.querySelectorAll('.highlight');
    elements.forEach(element => {
        element.outerHTML = element.innerHTML;
    });
}

// Event listener for search input
document.getElementById('search-input').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    highlight(query);
});
