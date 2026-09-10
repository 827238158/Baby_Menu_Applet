function validateDishForm(dish, categoryIds) {
  const categorySet = categoryIds instanceof Set ? categoryIds : new Set(categoryIds || [])
  if (!String(dish && dish.name || '').trim()) return { message: '请填写菜名', fieldId: 'dish-name' }
  if (!dish || !categorySet.has(dish.categoryId)) return { message: '请选择有效分类', fieldId: 'dish-category' }

  for (const [optionIndex, option] of (dish.options || []).entries()) {
    if (!String(option && option.name || '').trim()) {
      return { message: option && option.type === 'text' ? '请填写备注名称' : '请填写规格名称', fieldId: `option-${optionIndex}-name` }
    }
    if (option.type === 'text') {
      const maxlength = Number(option.maxlength)
      if (!Number.isInteger(maxlength) || maxlength < 1 || maxlength > 200) {
        return { message: '备注字数应为 1 到 200 的整数', fieldId: `option-${optionIndex}-maxlength` }
      }
      continue
    }
    if (!Array.isArray(option.choices) || !option.choices.length) {
      return { message: '请至少添加一个规格选项', fieldId: `option-${optionIndex}-choices` }
    }
    const choiceIndex = option.choices.findIndex((choice) => !String(typeof choice === 'string' ? choice : choice && choice.name || '').trim())
    if (choiceIndex >= 0) return { message: '请填写规格的所有选项', fieldId: `option-${optionIndex}-choice-${choiceIndex}` }
  }
  return null
}

module.exports = { validateDishForm }
