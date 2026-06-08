export default {
  shop: {
    name: '我的私房菜单',
    subtitle: '今日限定 · 仅供展示 · 欢迎分享给朋友查看',
    shareTitle: '来看看我的专属菜单',
    shareImage: '../../assets/share.jpg'
  },
  categories: [
    {
      id: 'main',
      name: '主食',
      items: [
        {
          id: 'rice01',
          name: '黑椒牛肉饭',
          desc: '黑椒风味，牛肉鲜嫩，搭配时蔬和米饭。',
          price: '28',
          image: '../../assets/foods/beef-rice.jpg',
          tags: ['招牌', '推荐']
        },
        {
          id: 'noodle01',
          name: '番茄鸡蛋面',
          desc: '酸甜番茄汤底，配软嫩鸡蛋和劲道面条。',
          price: '22',
          image: '../../assets/foods/tomato-noodle.jpg',
          tags: ['清爽']
        }
      ]
    },
    {
      id: 'soup',
      name: '汤品',
      items: [
        {
          id: 'soup01',
          name: '山药鸡汤',
          desc: '慢炖鸡汤，汤色清亮，适合家庭聚餐展示。',
          price: '36',
          image: '../../assets/foods/chicken-soup.jpg',
          tags: ['限量', '暖胃']
        }
      ]
    },
    {
      id: 'drink',
      name: '饮品',
      items: [
        {
          id: 'drink01',
          name: '手作柠檬茶',
          desc: '鲜切柠檬搭配清茶，口感清新。',
          price: '16',
          image: '../../assets/foods/lemon-tea.jpg',
          tags: ['推荐']
        }
      ]
    }
  ]
}
