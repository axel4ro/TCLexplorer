document.getElementById('search-input').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    const elements = document.querySelectorAll('.content div');

    elements.forEach(element => {
        if (element.textContent.toLowerCase().includes(query)) {
            element.style.display = 'block';
        } else {
            element.style.display = 'none';
        }
    });
});
