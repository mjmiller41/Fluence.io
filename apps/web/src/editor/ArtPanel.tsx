import { useState } from 'react';
import { artCategories, artItemsByCategory } from 'scene';
import { useEditor } from './store';

const ALL = '__all';

export function ArtPanel() {
  const version = useEditor((s) => s.version);
  const artLibrary = useEditor((s) => s.artLibrary);
  const selection = useEditor((s) => s.selection);
  void version; // re-render when the library/selection changes

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState(ALL);

  const store = useEditor.getState();
  const categories = artCategories(artLibrary);
  const items = filter === ALL ? artLibrary.items : artItemsByCategory(artLibrary, filter);

  const onSave = (): void => {
    void store.saveSelectionAsArt(name, category);
    setName('');
    setCategory('');
  };

  return (
    <section className="art" data-testid="art-panel">
      <div className="cam__header">Art library</div>

      <div className="art__save">
        <input
          type="text"
          placeholder="Name"
          value={name}
          data-testid="art-name"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Category"
          value={category}
          data-testid="art-category"
          onChange={(e) => setCategory(e.target.value)}
        />
        <button
          type="button"
          data-testid="save-art"
          disabled={name.trim() === '' || selection.length === 0}
          onClick={onSave}
        >
          Save selection
        </button>
      </div>

      {categories.length > 1 && (
        <label className="cam__field">
          <span>Category</span>
          <select value={filter} data-testid="art-filter" onChange={(e) => setFilter(e.target.value)}>
            <option value={ALL}>All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}

      {items.length === 0 ? (
        <p className="art__empty">No saved art yet — select shapes and Save.</p>
      ) : (
        <ul className="art__list">
          {items.map((item) => (
            <li key={item.id} data-testid={`art-item-${item.id}`}>
              <span className="art__name">{item.name}</span>
              <button
                type="button"
                data-testid="insert-art"
                title="Insert into document"
                onClick={() => store.insertArt(item.id)}
              >
                +
              </button>
              <button type="button" title="Delete preset" onClick={() => void store.removeArt(item.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
