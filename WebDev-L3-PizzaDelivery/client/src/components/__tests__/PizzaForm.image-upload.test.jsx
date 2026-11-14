import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PizzaForm } from '../PizzaForm.jsx';
import * as adminApi from '../../api/admin.js';
import * as catalogueApi from '../../api/catalogue.js';

vi.mock('../../api/admin.js', () => ({
  createPizza: vi.fn(),
  updatePizza: vi.fn(),
  uploadPizzaImage: vi.fn(),
  deletePizzaImage: vi.fn()
}));

vi.mock('../../api/catalogue.js', () => ({
  getIngredients: vi.fn()
}));

const id = '507f1f77bcf86cd799439011';
const ingredients = {
  base: [{ id: 'base1', name: 'Thin Crust', pricePaise: 15000 }],
  sauce: [{ id: 'sauce1', name: 'Tomato', pricePaise: 8000 }],
  cheese: [{ id: 'cheese1', name: 'Mozzarella', pricePaise: 15000 }],
  vegetable: [],
  protein: []
};

async function fillFormWithImage() {
  await screen.findByRole('button', { name: 'Create Pizza' });
  fireEvent.change(screen.getByLabelText('Name *'), {
    target: { value: 'Test Pizza' }
  });
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', {
    type: 'image/png'
  });
  fireEvent.change(screen.getByLabelText('Upload Image'), {
    target: { files: [file] }
  });
  return file;
}

describe('PizzaForm automatic image upload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    catalogueApi.getIngredients.mockResolvedValue(ingredients);
    adminApi.createPizza.mockResolvedValue({ pizza: { id } });
    adminApi.updatePizza.mockResolvedValue({ pizza: { id } });
    adminApi.uploadPizzaImage.mockResolvedValue({
      pizza: { id, imageUrl: '/uploads/pizzas/generated.png' }
    });
  });

  it('creates the pizza, then uploads the selected image using the new ID', async () => {
    const onSave = vi.fn();
    render(<PizzaForm csrfToken="csrf-test" onSave={onSave} onCancel={vi.fn()} />);
    const file = await fillFormWithImage();

    fireEvent.click(screen.getByRole('button', { name: 'Create Pizza' }));

    await waitFor(() => expect(adminApi.uploadPizzaImage)
      .toHaveBeenCalledWith(id, file, 'csrf-test'));
    expect(adminApi.createPizza).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith();
    expect(adminApi.createPizza.mock.invocationCallOrder[0])
      .toBeLessThan(adminApi.uploadPizzaImage.mock.invocationCallOrder[0]);
  });

  it('reports partial success without retrying pizza creation when image upload fails', async () => {
    adminApi.uploadPizzaImage.mockRejectedValue(new Error('Upload unavailable'));
    const onSave = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<PizzaForm csrfToken="csrf-test" onSave={onSave} onCancel={vi.fn()} />);
      await fillFormWithImage();
      fireEvent.click(screen.getByRole('button', { name: 'Create Pizza' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledWith({
        warning: expect.stringContaining('Upload unavailable')
      }));
      expect(adminApi.createPizza).toHaveBeenCalledTimes(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('uploads a newly selected image when an existing pizza is updated', async () => {
    const onSave = vi.fn();
    const pizza = {
      id,
      name: 'Existing Pizza',
      category: 'vegetarian',
      imageUrl: '',
      ingredients: {
        base: { id: 'base1' },
        sauce: { id: 'sauce1' },
        cheese: { id: 'cheese1' },
        vegetables: [],
        proteins: []
      }
    };
    render(<PizzaForm mode="edit" pizza={pizza} csrfToken="csrf-test"
      onSave={onSave} onCancel={vi.fn()} />);
    await screen.findByRole('button', { name: 'Update Pizza' });
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'new.png', {
      type: 'image/png'
    });
    fireEvent.change(screen.getByLabelText('Upload Image'), {
      target: { files: [file] }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update Pizza' }));

    await waitFor(() => expect(adminApi.uploadPizzaImage)
      .toHaveBeenCalledWith(id, file, 'csrf-test'));
    expect(adminApi.updatePizza).toHaveBeenCalledWith(
      id, expect.objectContaining({ name: 'Existing Pizza' }), 'csrf-test'
    );
    expect(onSave).toHaveBeenCalledWith();
  });

  it('does not upload an image when none was selected', async () => {
    const onSave = vi.fn();
    render(<PizzaForm csrfToken="csrf-test" onSave={onSave} onCancel={vi.fn()} />);
    await screen.findByRole('button', { name: 'Create Pizza' });
    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'No Image Pizza' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Pizza' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(adminApi.uploadPizzaImage).not.toHaveBeenCalled();
  });
});
