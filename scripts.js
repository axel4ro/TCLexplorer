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

// Funcția pentru toggle a temei
const themeToggleButton = document.getElementById('theme-toggle-button');
const themeIcon = document.getElementById('theme-icon');

themeToggleButton.addEventListener('click', function() {
    const body = document.body;

    if (body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        themeIcon.src = 'sun.png';  // Imagine pentru light mode
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        themeIcon.src = 'moon.png';  // Imagine pentru dark mode
    }
});
