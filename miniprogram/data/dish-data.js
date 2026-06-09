export default [
  {
    id: 'rice01',
    categoryId: 'main',
    order: 10,
    name: '黑椒牛肉饭',
    desc: '黑椒酱汁裹住鲜嫩牛肉，搭配时蔬和米饭，适合做一份饱足主食。',
    price: '0',
    image: '../../assets/foods/beef-rice.jpg',
    tags: ['招牌', '推荐'],
    options: [
      {
        id: 'taste',
        name: '口味',
        required: true,
        choices: ['原味', '少辣', '黑椒加浓']
      }
    ]
  },
  {
    id: 'noodle01',
    categoryId: 'main',
    order: 20,
    name: '番茄鸡蛋面',
    desc: '酸甜番茄汤底，配软嫩鸡蛋和劲道面条，清爽但不寡淡。',
    price: '0',
    image: '../../assets/foods/tomato-noodle.jpg',
    tags: ['清爽'],
    options: [
      {
        id: 'noodleTexture',
        name: '面条口感',
        required: true,
        choices: ['偏软', '正常', '劲道']
      }
    ]
  },
  {
    id: 'soup01',
    categoryId: 'soup',
    order: 10,
    name: '山药鸡汤',
    desc: '慢炖鸡汤，汤色清亮，山药软糯，适合家庭聚餐展示。',
    price: '0',
    image: '../../assets/foods/chicken-soup.jpg',
    tags: ['限量', '暖胃'],
    options: []
  },
  {
    id: 'dessert01',
    categoryId: 'dessert',
    order: 10,
    name: '榴莲千层',
    desc: '1',
    price: '0',
    image: '../../assets/foods/chicken-soup.jpg',
    tags: [],
    options: []
  },
  {
    id: 'drink01',
    categoryId: 'drink',
    order: 10,
    name: '手作柠檬茶',
    desc: '鲜切柠檬搭配清茶，酸甜平衡，适合餐后慢慢喝。',
    price: '0',
    image: '../../assets/foods/lemon-tea.jpg',
    tags: ['推荐'],
    options: [
      {
        id: 'temperature',
        name: '冷热',
        required: true,
        choices: ['热饮', '常温', '少冰']
      },
      {
        id: 'sweetness',
        name: '甜度',
        required: true,
        choices: ['无糖', '三分糖', '五分糖', '正常糖']
      }
    ]
  },
  {
    id: 'kawangka01',
    categoryId: 'kawangka',
    order: 10,
    name: '芒果爽',
    desc: '芒果风味的清爽沙冰饮品，果香明亮，适合作为夏日甜品饮料展示。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['芒果', '沙冰'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['沙冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '五分糖']
      },
      {
        id: 'forkSpoon',
        name: '长叉勺',
        required: true,
        choices: ['需要', '不需要']
      }
    ]
  },
  {
    id: 'kawangka02',
    categoryId: 'kawangka',
    order: 20,
    name: '椰子清补凉',
    desc: '椰香清爽的清补凉风味饮品，搭配椰奶冻、椰果和马蹄丸子，口感层次丰富。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['椰香', '清补凉'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['轻沙冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '三分糖']
      },
      {
        id: 'coconutJelly',
        name: '椰奶冻',
        required: true,
        choices: ['标准椰奶冻', '少椰奶冻', '无椰奶冻']
      },
      {
        id: 'nata',
        name: '椰果',
        required: true,
        choices: ['标准椰果', '少椰果', '无椰果']
      },
      {
        id: 'waterChestnutBall',
        name: '马蹄丸子',
        required: true,
        choices: ['标准马蹄丸子', '多马蹄椰子', '少马蹄椰子', '无马蹄椰子']
      }
    ]
  },
  {
    id: 'kawangka03',
    categoryId: 'kawangka',
    order: 30,
    name: '芒果酸奶奶昔',
    desc: '芒果果香和酸奶奶昔融合，口感绵密清甜，搭配西米更有咀嚼感。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['芒果', '酸奶'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '三分糖', '不另外加糖']
      },
      {
        id: 'sago',
        name: '西米',
        required: true,
        choices: ['标准西米', '少西米', '多西米', '无西米']
      }
    ]
  },
  {
    id: 'kawangka04',
    categoryId: 'kawangka',
    order: 40,
    name: '满满橙意茶',
    desc: '橙香清新的果茶饮品，酸甜明快，可选少冰、热饮或去冰。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['橙香', '果茶'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['少冰', '热', '去冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '五分糖', '三分糖', '不另外加糖']
      }
    ]
  },
  {
    id: 'kawangka05',
    categoryId: 'kawangka',
    order: 50,
    name: '徽州酒酿',
    desc: '带有酒酿香气的轻沙冰饮品，甜润柔和，搭配马蹄丸子增加口感。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['酒酿', '沙冰'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['轻沙冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖【推荐】', '五分糖', '三分糖']
      },
      {
        id: 'waterChestnutBall',
        name: '马蹄丸子',
        required: true,
        choices: ['标准马蹄丸子', '多马蹄丸子', '少马蹄丸子', '无马蹄丸子']
      }
    ]
  },
  {
    id: 'kawangka06',
    categoryId: 'kawangka',
    order: 60,
    name: '黑全套奶茶',
    desc: '卡旺卡经典奶茶，搭配黑糖布丁、芋圆和黑米等小料，口感扎实丰富。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['经典', '奶茶'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['少冰', '热', '去冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '三分糖', '十分糖', '不另外加糖']
      },
      {
        id: 'brownSugarPudding',
        name: '黑糖布丁',
        required: true,
        choices: ['标准黑糖布丁', '少黑糖布丁', '多黑糖布丁', '无黑糖布丁']
      },
      {
        id: 'taroBall',
        name: '芋圆',
        required: true,
        choices: ['标准芋圆', '少芋圆', '多芋圆', '无芋圆']
      },
      {
        id: 'blackRice',
        name: '黑米',
        required: true,
        choices: ['多黑米', '少黑米', '标准黑米', '无黑米']
      }
    ]
  },
  {
    id: 'kawangka07',
    categoryId: 'kawangka',
    order: 70,
    name: '桂花酸奶',
    desc: '桂花香与酸奶风味融合，清甜顺滑，搭配芋圆和桂花冰粉更有层次。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['桂花', '酸奶'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['不另外加糖']
      },
      {
        id: 'taroBall',
        name: '芋圆',
        required: true,
        choices: ['标准芋圆', '多芋圆', '少芋圆', '无芋圆']
      },
      {
        id: 'osmanthusJelly',
        name: '桂花冰粉',
        required: true,
        choices: ['标准桂花冰粉', '少桂花冰粉', '无桂花冰粉']
      }
    ]
  },
  {
    id: 'kawangka08',
    categoryId: 'kawangka',
    order: 80,
    name: '杨枝甘露',
    desc: '芒果与柑橘风味的经典甜品饮品，搭配西柚粒和西米，清甜有果香。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['芒果', '经典'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['少冰', '温热']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '五分糖', '三分糖']
      },
      {
        id: 'grapefruit',
        name: '西柚粒',
        required: true,
        choices: ['标准西柚粒', '多西柚粒', '少西柚粒', '无西柚粒']
      },
      {
        id: 'sago',
        name: '西米',
        required: true,
        choices: ['标准西米', '少西米', '多西米', '无西米']
      }
    ]
  },
  {
    id: 'kawangka09',
    categoryId: 'kawangka',
    order: 90,
    name: '桂花酒酿小丸子',
    desc: '桂花香、酒酿和小料组合的甜润饮品，可搭配芋圆和桂花冰粉，口感软糯清香。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['桂花', '酒酿'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['少冰', '温热', '去冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖【推荐】', '五分糖', '三分糖']
      },
      {
        id: 'taroBall',
        name: '芋圆',
        required: true,
        choices: ['标准芋圆', '多芋圆', '少芋圆', '无芋圆']
      },
      {
        id: 'osmanthusJelly',
        name: '桂花冰粉',
        required: true,
        choices: ['标准桂花冰粉', '少桂花冰粉', '多桂花冰粉', '无桂花冰粉']
      }
    ]
  },
  {
    id: 'kawangka10',
    categoryId: 'kawangka',
    order: 100,
    name: '满杯猕猴桃',
    desc: '猕猴桃果香清爽，酸甜开胃，搭配冰粉带来轻盈顺滑的口感。',
    price: '0',
    image: '../../assets/placeholder-food.jpg',
    tags: ['猕猴桃', '果茶'],
    options: [
      {
        id: 'spec',
        name: '规格',
        required: true,
        choices: ['少冰', '去冰']
      },
      {
        id: 'sweetness',
        name: '糖度',
        required: true,
        choices: ['七分糖', '三分糖']
      },
      {
        id: 'jelly',
        name: '冰粉',
        required: true,
        choices: ['标准冰粉', '少冰粉', '多冰粉', '无冰粉']
      }
    ]
  },
  {
    id: 'fruit01',
    categoryId: 'fruit',
    order: 10,
    name: '荔枝',
    desc: '夏季时令水果，果肉清甜多汁。按常见饮食说法偏温热，吃多了容易上火。',
    price: '0',
    image: '../../assets/foods/lychee.jpg',
    tags: ['夏季', '偏温热', '易上火'],
    options: []
  },
  {
    id: 'fruit02',
    categoryId: 'fruit',
    order: 20,
    name: '西瓜',
    desc: '夏季代表水果，清甜多汁。按常见饮食说法偏寒凉，适合做清爽解腻的展示项。',
    price: '0',
    image: '../../assets/foods/watermelon.jpg',
    tags: ['夏季', '寒凉', '清爽'],
    options: []
  },
  {
    id: 'fruit03',
    categoryId: 'fruit',
    order: 30,
    name: '蓝莓',
    desc: '夏季常见浆果，酸甜小颗，适合搭配酸奶或甜品,平性或偏凉。',
    price: '0',
    image: '../../assets/foods/blueberry.jpg',
    tags: ['夏季', '平性', '酸甜'],
    options: []
  },
  {
    id: 'fruit04',
    categoryId: 'fruit',
    order: 40,
    name: '芒果',
    desc: '夏季热带水果，香气浓郁、口感绵甜。偏温，部分人吃多了容易上火。',
    price: '0',
    image: '../../assets/foods/mango.jpg',
    tags: ['夏季', '偏温', '易上火'],
    options: []
  },
  {
    id: 'fruit05',
    categoryId: 'fruit',
    order: 50,
    name: '草莓',
    desc: '冬春季常见水果，酸甜清香。',
    price: '0',
    image: '../../assets/foods/strawberry.jpg',
    tags: ['冬春', '偏凉', '酸甜'],
    options: []
  },
  {
    id: 'fruit06',
    categoryId: 'fruit',
    order: 60,
    name: '桃子',
    desc: '夏季水果，果香明显、口感柔软。偏温，适量享用。',
    price: '0',
    image: '../../assets/foods/peach.jpg',
    tags: ['夏季', '偏温'],
    options: []
  },
  {
    id: 'fruit07',
    categoryId: 'fruit',
    order: 70,
    name: '梨',
    desc: '秋季常见水果，水分足、口感清甜。',
    price: '0',
    image: '../../assets/foods/pear.jpg',
    tags: ['秋季', '偏凉', '清润'],
    options: []
  },
  {
    id: 'fruit08',
    categoryId: 'fruit',
    order: 80,
    name: '葡萄',
    desc: '夏秋季水果，酸甜多汁。',
    price: '0',
    image: '../../assets/foods/grape.jpg',
    tags: ['夏秋', '平性'],
    options: []
  },
  {
    id: 'fruit09',
    categoryId: 'fruit',
    order: 90,
    name: '火龙果',
    desc: '夏秋季常见水果，清甜柔软。',
    price: '0',
    image: '../../assets/foods/dragon-fruit.jpg',
    tags: ['夏秋', '偏凉'],
    options: []
  },
  {
    id: 'fruit10',
    categoryId: 'fruit',
    order: 100,
    name: '橙子',
    desc: '秋冬季常见水果，酸甜多汁、香气清新。',
    price: '0',
    image: '../../assets/foods/orange.jpg',
    tags: ['秋冬', '偏凉'],
    options: []
  }
]
