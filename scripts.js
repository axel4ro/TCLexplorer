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
            highlightElement(element, searchRegExp);
        });
    }
}

// Function to highlight text within an element
function highlightElement(element, searchRegExp) {
    for (let node of element.childNodes) {
        if (node.nodeType === 3) { // Text node
            const match = node.data.match(searchRegExp);
            if (match) {
                const span = document.createElement('span');
                span.innerHTML = node.data.replace(searchRegExp, '<span class="highlight">$&</span>');
                node.parentNode.replaceChild(span, node);
            }
        } else if (node.nodeType === 1 && node.childNodes && !/script|style/i.test(node.tagName)) {
            highlightElement(node, searchRegExp);
        }
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
