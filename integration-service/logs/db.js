const fs = require('fs').promises;
const path = require('path');

class JsonDatabase {
  constructor(filename) {
    this.filePath = path.join(__dirname, filename);
  }

  async read() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        const initialData = {};
        await this.write(initialData);
        return initialData;
      }
      throw error;
    }
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async getCollection(collectionName) {
    const db = await this.read();
    if (!db[collectionName]) {
      db[collectionName] = [];
      await this.write(db);
    }
    return db[collectionName];
  }

  async saveCollection(collectionName, items) {
    const db = await this.read();
    db[collectionName] = items;
    await this.write(db);
  }

  async insert(collectionName, item) {
    const items = await this.getCollection(collectionName);
    items.push(item);
    await this.saveCollection(collectionName, items);
    return item;
  }

  async find(collectionName, query = {}) {
    const items = await this.getCollection(collectionName);
    return items.filter(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }
}

module.exports = JsonDatabase;
