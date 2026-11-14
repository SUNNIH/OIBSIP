// SUNNYS Pizza — Admin Pizza Form (Create/Edit)
import { useEffect, useState } from 'react';

import * as catalogueApi from '../api/catalogue.js';

import * as adminApi from '../api/admin.js';

// Format paise to rupees
function formatRupees(paise) {

  if (typeof paise !== 'number' || isNaN(paise)) return '₹0.00';

  const rupees = paise / 100;

  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

}

export function PizzaForm({ mode = 'create', pizza = null, onSave, onCancel, csrfToken }) {

  // Form state
  const [name, setName] = useState('');

  const [description, setDescription] = useState('');

  const [category, setCategory] = useState('vegetarian');

  // Image state
  const [imageUrl, setImageUrl] = useState('');

  const [imageFile, setImageFile] = useState(null);

  const [imagePreview, setImagePreview] = useState('');

  const [uploadingImage, setUploadingImage] = useState(false);

  const [imageError, setImageError] = useState('');

  // Ingredient selections
  const [selectedBase, setSelectedBase] = useState('');

  const [selectedSauce, setSelectedSauce] = useState('');

  const [selectedCheese, setSelectedCheese] = useState('');

  const [selectedVegetables, setSelectedVegetables] = useState([]);

  const [selectedProteins, setSelectedProteins] = useState([]);

  // Ingredients options
  const [ingredients, setIngredients] = useState(null);

  const [loadingIngredients, setLoadingIngredients] = useState(true);

  // Form state
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');

  // Load ingredients
  useEffect(() => {

    async function loadIngredients() {

      try {

        setLoadingIngredients(true);

        const data = await catalogueApi.getIngredients();

        setIngredients(data);

        // Pre-populate form if editing
        if (mode === 'edit' && pizza) {

          setName(pizza.name || '');

          setDescription(pizza.description || '');

          setCategory(pizza.category || 'vegetarian');

          setImageUrl(pizza.imageUrl || '');

          setImagePreview(pizza.imageUrl || '');

          setSelectedBase(pizza.ingredients?.base?.id || '');

          setSelectedSauce(pizza.ingredients?.sauce?.id || '');

          setSelectedCheese(pizza.ingredients?.cheese?.id || '');

          setSelectedVegetables(pizza.ingredients?.vegetables?.map(v => v.id) || []);

          setSelectedProteins(pizza.ingredients?.proteins?.map(p => p.id) || []);

        } else if (mode === 'create') {

          // Set defaults for create mode
          if (data.base?.length > 0) setSelectedBase(data.base[0].id);

          if (data.sauce?.length > 0) setSelectedSauce(data.sauce[0].id);

          if (data.cheese?.length > 0) setSelectedCheese(data.cheese[0].id);

        }

      } catch (err) {

        console.error('Failed to load ingredients:', err);

        setError(err.message);

      } finally {

        setLoadingIngredients(false);

      }

    }

    loadIngredients();

  }, [mode, pizza]);

  // Calculate price preview
  const calculatePrice = () => {

    if (!ingredients || !selectedBase || !selectedSauce || !selectedCheese) {

      return null;

    }

    const basePrice = ingredients.base.find(b => b.id === selectedBase)?.pricePaise || 0;

    const saucePrice = ingredients.sauce.find(s => s.id === selectedSauce)?.pricePaise || 0;

    const cheesePrice = ingredients.cheese.find(c => c.id === selectedCheese)?.pricePaise || 0;

    const vegPrice = selectedVegetables.reduce((sum, vId) => {

      const veg = ingredients.vegetable.find(v => v.id === vId);

      return sum + (veg?.pricePaise || 0);

    }, 0);

    const proteinPrice = selectedProteins.reduce((sum, pId) => {

      const protein = ingredients.protein?.find(p => p.id === pId);

      return sum + (protein?.pricePaise || 0);

    }, 0);

    return basePrice + saucePrice + cheesePrice + vegPrice + proteinPrice;

  };

  // Handle vegetable toggle
  const toggleVegetable = (vegId) => {

    setSelectedVegetables(prev =>

      prev.includes(vegId) ? prev.filter(id => id !== vegId) : [...prev, vegId]

    );

  };

  // Handle protein toggle
  const toggleProtein = (proteinId) => {

    setSelectedProteins(prev =>

      prev.includes(proteinId) ? prev.filter(id => id !== proteinId) : [...prev, proteinId]

    );

  };

  // Handle image file selection
  const handleImageFileChange = (e) => {

    const file = e.target.files?.[0];

    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!validTypes.includes(file.type)) {

      setImageError('Please select a JPEG, PNG, or WebP image');

      return;

    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {

      setImageError('Image must be smaller than 5MB');

      return;

    }

    setImageError('');

    setImageFile(file);

    // Generate preview
    const reader = new FileReader();

    reader.onloadend = () => {

      setImagePreview(reader.result);

    };

    reader.readAsDataURL(file);

  };

  // Handle image upload (for edit mode with existing pizza)
  const handleImageUpload = async () => {

    if (!imageFile || !pizza?.id) return;

    try {

      setUploadingImage(true);

      setImageError('');

      const result = await adminApi.uploadPizzaImage(pizza.id, imageFile, csrfToken);

      setImageUrl(result.pizza.imageUrl);

      setImagePreview(result.pizza.imageUrl);

      setImageFile(null);

      // Reset file input
      const fileInput = document.getElementById('pizza-image-file');

      if (fileInput) fileInput.value = '';

    } catch (err) {

      console.error('Failed to upload image:', err);

      setImageError(err.message);

    } finally {

      setUploadingImage(false);

    }

  };

  // Handle image removal
  const handleImageRemove = async () => {

    if (mode === 'edit' && pizza?.id && imageUrl) {

      // Remove from server for existing pizza
      const confirmed = window.confirm('Remove this image? This cannot be undone.');

      if (!confirmed) return;

      try {

        setUploadingImage(true);

        setImageError('');

        await adminApi.deletePizzaImage(pizza.id, csrfToken);

        setImageUrl('');

        setImagePreview('');

        setImageFile(null);

      } catch (err) {

        console.error('Failed to remove image:', err);

        setImageError(err.message);

      } finally {

        setUploadingImage(false);

      }

    } else {

      // Just clear preview for new images not yet uploaded
      setImagePreview('');

      setImageFile(null);

      const fileInput = document.getElementById('pizza-image-file');

      if (fileInput) fileInput.value = '';

    }

  };

  // Validate form
  const validate = () => {

    if (!name.trim()) {

      setError('Pizza name is required');

      return false;

    }

    if (!selectedBase || !selectedSauce || !selectedCheese) {

      setError('Base, sauce, and cheese are required');

      return false;

    }

    if (category === 'non-vegetarian' && selectedProteins.length === 0) {

      setError('Non-vegetarian pizzas must have at least one protein');

      return false;

    }

    if (['vegetarian', 'vegan'].includes(category) && selectedProteins.length > 0) {

      setError('Vegetarian and vegan pizzas cannot contain proteins');

      return false;

    }

    return true;

  };

  // Handle submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setImageError('');

    if (!validate()) return;

    if (!csrfToken) {
      setError('Security token missing. Please refresh the page.');
      return;
    }

    try {
      setSaving(true);

      const pizzaData = {
        name: name.trim(),
        description: description.trim(),
        category,
        ingredients: {
          base: selectedBase,
          sauce: selectedSauce,
          cheese: selectedCheese,
          vegetables: selectedVegetables,
          proteins: selectedProteins
        }
      };

      // The API creates the MongoDB document first. An image can only
      // be uploaded once we know its ID.
      const saved = mode === 'create'
        ? await adminApi.createPizza(pizzaData, csrfToken)
        : await adminApi.updatePizza(pizza.id, pizzaData, csrfToken);

      // Upload selected images as part of the normal Save operation.
      // The backend generates the filename and persists `pizza.imageUrl`.
      if (imageFile) {
        const targetPizzaId = mode === 'create'
          ? (saved?.pizza?.id || saved?.pizza?._id)
          : pizza?.id;

        if (!targetPizzaId) {
          await onSave({
            warning: `Pizza "${pizzaData.name}" was saved, but its image could not be uploaded because the server did not return a pizza ID. Open Edit to retry.`
          });
          return;
        }

        try {
          await adminApi.uploadPizzaImage(targetPizzaId, imageFile, csrfToken);
        } catch (uploadError) {
          // Do not retry creating the pizza: the database write succeeded.
          // Close/reload and let the admin retry through Edit instead.
          console.error('Pizza saved, but image upload failed:', uploadError);
          await onSave({
            warning: `Pizza "${pizzaData.name}" was saved, but its image upload failed: ${uploadError.message || 'Unknown error'}. Open Edit to retry.`
          });
          return;
        }
      }

      await onSave();
    } catch (err) {
      console.error('Failed to save pizza:', err);
      setError(err.message || 'Failed to save pizza');
    } finally {
      setSaving(false);
    }
  };

  const pricePaise = calculatePrice();

  if (loadingIngredients) {

    return (

      <div className="pizza-form">

        <div className="pizza-form__loading">

          <div className="spinner" />

          <p>Loading ingredients...</p>

        </div>

      </div>

    );

  }

  return (

  <form className="pizza-form" onSubmit={handleSubmit}>

      {error && (

        <div className="pizza-form__error" role="alert">

          {error}

        </div>

      )}

      {/* Basic Info */}

      <div className="form-section">

        <h3>Basic Information</h3>

        <div className="form-field">

          <label htmlFor="name">Name *</label>

          <input

            id="name"

            type="text"

            value={name}

            onChange={(e) => setName(e.target.value)}

            required

            placeholder="e.g., Margherita Supreme"

          />

        </div>

        <div className="form-field">

          <label htmlFor="description">Description</label>

          <textarea

            id="description"

            value={description}

            onChange={(e) => setDescription(e.target.value)}

            rows={3}

            placeholder="Brief description of the pizza..."

          />

        </div>

        <div className="form-field">

          <label htmlFor="category">Category *</label>

          <select

            id="category"

            value={category}

            onChange={(e) => setCategory(e.target.value)}

            required

          >

            <option value="vegetarian">Vegetarian</option>

            <option value="vegan">Vegan</option>

            <option value="non-vegetarian">Non-Vegetarian</option>

          </select>

        </div>

      </div>

      {/* Image Management */}

      <div className="form-section">

        <h3>Pizza Image</h3>

        {imagePreview && (

          <div className="image-preview">

            <img 

              src={imagePreview} 

              alt="Pizza preview" 

              onError={() => setImageError('Failed to load image')}

            />

            <button

              type="button"

              className="button button--small button--warning"

              onClick={handleImageRemove}

              disabled={uploadingImage}

            >

              Remove Image

            </button>

          </div>

        )}

        {!imagePreview && (

          <div className="image-placeholder">

            <svg className="image-placeholder__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">

              <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>

            </svg>

            <p>No image selected</p>

          </div>

        )}

        <div className="form-field">

          <label htmlFor="pizza-image-file">Upload Image</label>

          <input

            id="pizza-image-file"

            type="file"

            accept="image/jpeg,image/png,image/webp"

            onChange={handleImageFileChange}

            disabled={uploadingImage}

          />

          <p className="form-help">

            JPEG, PNG, or WebP • Maximum 5MB

          </p>

        </div>

        {imageError && (

          <div className="form-error" role="alert">

            {imageError}

          </div>

        )}

        {mode === 'edit' && imageFile && (

          <button

            type="button"

            className="button button--secondary"

            onClick={handleImageUpload}

            disabled={uploadingImage}

          >

            {uploadingImage ? 'Uploading...' : 'Upload Image Now'}

          </button>

        )}

        {mode === 'create' && imageFile && (

          <p className="form-help">

            Image will be uploaded automatically when you create the pizza.

          </p>

        )}

      </div>

      {/* Recipe */}

      <div className="form-section">

        <h3>Recipe</h3>

        {/* Base */}

        <div className="form-field">

          <label htmlFor="base">Base *</label>

          <select

            id="base"

            value={selectedBase}

            onChange={(e) => setSelectedBase(e.target.value)}

            required

          >

            <option value="">Select base</option>

            {ingredients?.base?.map(b => (

              <option key={b.id} value={b.id}>

                {b.name} ({formatRupees(b.pricePaise)})

              </option>

            ))}

          </select>

        </div>

        {/* Sauce */}

        <div className="form-field">

          <label htmlFor="sauce">Sauce *</label>

          <select

            id="sauce"

            value={selectedSauce}

            onChange={(e) => setSelectedSauce(e.target.value)}

            required

          >

            <option value="">Select sauce</option>

            {ingredients?.sauce?.map(s => (

              <option key={s.id} value={s.id}>

                {s.name} ({formatRupees(s.pricePaise)})

              </option>

            ))}

          </select>

        </div>

        {/* Cheese */}

        <div className="form-field">

          <label htmlFor="cheese">Cheese *</label>

          <select

            id="cheese"

            value={selectedCheese}

            onChange={(e) => setSelectedCheese(e.target.value)}

            required

          >

            <option value="">Select cheese</option>

            {ingredients?.cheese?.map(c => (

              <option key={c.id} value={c.id}>

                {c.name} ({formatRupees(c.pricePaise)})

              </option>

            ))}

          </select>

        </div>

        {/* Vegetables */}

        <div className="form-field">

          <label>Vegetables (optional)</label>

          <div className="checkbox-group">

            {ingredients?.vegetable?.map(v => (

              <label key={v.id} className="checkbox-label">

                <input

                  type="checkbox"

                  checked={selectedVegetables.includes(v.id)}

                  onChange={() => toggleVegetable(v.id)}

                />

                <span>{v.name} ({formatRupees(v.pricePaise)})</span>

              </label>

            ))}

          </div>

        </div>

        {/* Proteins */}

        <div className="form-field">

          <label>Proteins {category === 'non-vegetarian' ? '*' : '(not allowed)'}</label>

          <div className="checkbox-group">

            {ingredients?.protein?.map(p => (

              <label key={p.id} className="checkbox-label">

                <input

                  type="checkbox"

                  checked={selectedProteins.includes(p.id)}

                  onChange={() => toggleProtein(p.id)}

                  disabled={['vegetarian', 'vegan'].includes(category)}

                />

                <span>{p.name} ({formatRupees(p.pricePaise)})</span>

              </label>

            ))}

          </div>

          {category === 'non-vegetarian' && (

            <p className="form-help">Non-vegetarian pizzas require at least one protein.</p>

          )}

          {['vegetarian', 'vegan'].includes(category) && (

            <p className="form-help">Proteins not allowed for {category} pizzas.</p>

          )}

        </div>

      </div>

      {/* Price Preview */}

      {pricePaise !== null && (

        <div className="form-section price-preview">

          <h3>Price Preview</h3>

          <div className="price-display">

            {formatRupees(pricePaise)}

          </div>

          <p className="form-help">Final price calculated by backend</p>

        </div>

      )}

      {/* Actions */}

      <div className="form-actions">

        <button

          type="button"

          className="button button--outline"

          onClick={onCancel}

          disabled={saving}

        >

          Cancel

        </button>

        <button

          type="submit"

          className="button button--primary"

          disabled={saving}

        >

          {saving ? 'Saving...' : mode === 'create' ? 'Create Pizza' : 'Update Pizza'}

        </button>

      </div>

    </form>

  );

}
