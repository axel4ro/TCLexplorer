document.getElementById('search-input').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    const elements = document.querySelectorAll('.content div');

    const options = {
        keys: ['textContent'],
        threshold: 0.3
    };

    const fuse = new Fuse([...elements], options);
    const results = fuse.search(query);

    elements.forEach(element => {
        element.style.display = 'none';
    });

    results.forEach(result => {
        result.item.style.display = 'block';
    });
});
