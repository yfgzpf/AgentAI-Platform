/**
 * 装修材料价格管理路由 (/v1/materials)
 * ----------------------------------------------------
 * 支持用户上传本地区材料价格表，AI 自动解析并用于预算计算
 * 
 * 存储: ~/.agentai/materials-prices/
 *   - prices.json    ← 结构化价格数据
 *   - {userId}/      ← 用户专属价格表
 * 
 * 支持格式: .xlsx, .xls, .csv, .json
 * 打包后可用：数据存储在运行时目录，非打包内
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import os from 'os';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// 存储路径（用户目录，打包后可用）
const MATERIALS_DIR = path.join(os.homedir(), '.agentai', 'materials-prices');
const PRICES_FILE = path.join(MATERIALS_DIR, 'prices.json');

// ==================== 类型定义 ====================

export interface MaterialPrice {
  id: string;
  name: string;
  category: 'floor' | 'wall' | 'ceiling' | 'furniture' | 'lighting' | 'hardware' | 'soft' | 'labor';
  subCategory: string;
  price: number;
  unit: string;
  brand?: string;
  spec?: string;
  region?: string; // 地区
  source: string; // 来源：用户上传/系统默认
  updatedAt: number;
}

export interface MaterialPriceTable {
  version: string;
  region: string;
  updatedAt: number;
  materials: MaterialPrice[];
  uploadedBy?: string;
}

// ==================== 数据操作 ====================

async function ensureDir() {
  await fs.mkdir(MATERIALS_DIR, { recursive: true });
}

async function loadPrices(): Promise<MaterialPriceTable> {
  try {
    const data = await fs.readFile(PRICES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    // 返回默认空表
    return {
      version: '1.0',
      region: '全国',
      updatedAt: Date.now(),
      materials: [],
    };
  }
}

async function savePrices(table: MaterialPriceTable) {
  await ensureDir();
  await fs.writeFile(PRICES_FILE, JSON.stringify(table, null, 2), 'utf-8');
}

// 解析 Excel/CSV 价格表
async function parsePriceTable(buffer: Buffer, ext: string): Promise<Partial<MaterialPrice>[]> {
  const materials: Partial<MaterialPrice>[] = [];
  
  if (ext === '.csv') {
    // CSV 解析
    const content = buffer.toString('utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0]?.split(',').map(h => h.trim()) || [];
    
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => row[h] = cols[idx] || '');
      
      if (row['材料名称'] || row['name']) {
        materials.push({
          name: row['材料名称'] || row['name'] || '',
          category: (row['分类'] || row['category'] || 'floor') as any,
          subCategory: row['子分类'] || row['subCategory'] || '',
          price: parseFloat(row['单价'] || row['price'] || '0'),
          unit: row['单位'] || row['unit'] || '元/㎡',
          brand: row['品牌'] || row['brand'],
          spec: row['规格'] || row['spec'],
          region: row['地区'] || row['region'],
        });
      }
    }
  } else {
    // Excel 解析（简化版，实际使用 parseExcel）
    const { parseExcel } = await import('./parse-file.js');
    const result = await parseExcel(buffer, 'prices.xlsx');
    
    // 尝试从解析的文本中提取表格数据
    const lines = result.content.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      // 简单解析：材料名 分类 价格 单位
      const parts = line.split(/\s+|\t/).filter(p => p.trim());
      if (parts.length >= 3) {
        const price = parseFloat(parts.find(p => !isNaN(parseFloat(p)) && parseFloat(p) > 10) || '0');
        if (price > 0) {
          materials.push({
            name: parts[0],
            category: 'floor',
            price,
            unit: parts[parts.length - 1]?.includes('元') ? parts[parts.length - 1] : '元/㎡',
          });
        }
      }
    }
  }
  
  return materials;
}

// ==================== 路由 ====================

export function createMaterialsRouter(): Router {
  const router = Router();

  /**
   * GET /v1/materials
   * 获取当前材料价格表
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const table = await loadPrices();
      res.json({
        ok: true,
        data: table,
        count: table.materials.length,
        message: table.materials.length > 0 
          ? `已加载 ${table.materials.length} 条材料价格` 
          : '暂无材料价格数据，请先上传',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  /**
   * GET /v1/materials/category/:category
   * 按分类获取材料
   */
  router.get('/category/:category', async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      const table = await loadPrices();
      const materials = table.materials.filter(m => m.category === category);
      res.json({ ok: true, data: materials, count: materials.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  /**
   * POST /v1/materials/upload
   * 上传价格表文件 (Excel/CSV)
   */
  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ ok: false, error: 'No file uploaded' });
        return;
      }

      const region = (req.body.region as string) || '自定义地区';
      const { buffer, originalname } = file;
      const ext = path.extname(originalname || '').toLowerCase();

      if (!['.xlsx', '.xls', '.csv', '.json'].includes(ext)) {
        res.status(400).json({ ok: false, error: '仅支持 .xlsx, .xls, .csv, .json 格式' });
        return;
      }

      // 解析文件
      let newMaterials: Partial<MaterialPrice>[] = [];
      
      if (ext === '.json') {
        // 直接解析 JSON
        const json = JSON.parse(buffer.toString('utf-8'));
        newMaterials = Array.isArray(json) ? json : json.materials || [];
      } else {
        // 解析 Excel/CSV
        newMaterials = await parsePriceTable(buffer, ext);
      }

      if (newMaterials.length === 0) {
        res.status(400).json({ ok: false, error: '未能从文件中解析出材料数据' });
        return;
      }

      // 加载现有数据
      const table = await loadPrices();
      
      // 合并数据（新数据覆盖旧数据，按 name + category 匹配）
      const mergedMaterials = [...table.materials];
      
      for (const newMat of newMaterials) {
        if (!newMat.name || !newMat.price) continue;
        
        const existingIdx = mergedMaterials.findIndex(
          m => m.name === newMat.name && m.category === newMat.category
        );
        
        const material: MaterialPrice = {
          id: `mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: newMat.name,
          category: newMat.category || 'floor',
          subCategory: newMat.subCategory || '',
          price: newMat.price,
          unit: newMat.unit || '元/㎡',
          brand: newMat.brand,
          spec: newMat.spec,
          region: newMat.region || region,
          source: 'user-upload',
          updatedAt: Date.now(),
        };
        
        if (existingIdx >= 0) {
          mergedMaterials[existingIdx] = { ...mergedMaterials[existingIdx], ...material };
        } else {
          mergedMaterials.push(material);
        }
      }

      // 保存
      const newTable: MaterialPriceTable = {
        version: '1.0',
        region,
        updatedAt: Date.now(),
        materials: mergedMaterials,
        uploadedBy: (req as any).userId || 'anonymous',
      };
      
      await savePrices(newTable);

      res.json({
        ok: true,
        message: `成功导入 ${newMaterials.length} 条材料价格`,
        data: {
          region,
          totalCount: mergedMaterials.length,
          newCount: newMaterials.length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Upload failed' });
    }
  });

  /**
   * POST /v1/materials/add
   * 手动添加/更新单条材料
   */
  router.post('/add', async (req: Request, res: Response) => {
    try {
      const { name, category, price, unit, brand, spec, region } = req.body;
      
      if (!name || !price || !unit) {
        res.status(400).json({ ok: false, error: 'name, price, unit required' });
        return;
      }

      const table = await loadPrices();
      
      const material: MaterialPrice = {
        id: `mat-${Date.now()}`,
        name,
        category: category || 'floor',
        subCategory: '',
        price: parseFloat(price),
        unit,
        brand,
        spec,
        region: region || table.region,
        source: 'manual',
        updatedAt: Date.now(),
      };

      // 查找是否已存在
      const existingIdx = table.materials.findIndex(
        m => m.name === name && m.category === category
      );

      if (existingIdx >= 0) {
        table.materials[existingIdx] = material;
      } else {
        table.materials.push(material);
      }

      table.updatedAt = Date.now();
      await savePrices(table);

      res.json({ ok: true, material, message: existingIdx >= 0 ? '已更新' : '已添加' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  /**
   * DELETE /v1/materials/:id
   * 删除材料
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const table = await loadPrices();
      
      const idx = table.materials.findIndex(m => m.id === id);
      if (idx < 0) {
        res.status(404).json({ ok: false, error: 'Material not found' });
        return;
      }

      table.materials.splice(idx, 1);
      await savePrices(table);
      
      res.json({ ok: true, message: '已删除' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  /**
   * POST /v1/materials/calculate
   * 计算预算（使用用户上传的价格）
   */
  router.post('/calculate', async (req: Request, res: Response) => {
    try {
      const { items, area } = req.body; // items: [{ materialId/name, quantity }]
      
      if (!items || !Array.isArray(items)) {
        res.status(400).json({ ok: false, error: 'items required' });
        return;
      }

      const table = await loadPrices();
      
      const results = items.map((item: any) => {
        const material = table.materials.find(
          m => m.id === item.materialId || m.name === item.name
        );
        
        if (!material) {
          return {
            ...item,
            found: false,
            price: 0,
            total: 0,
            message: '未找到该材料价格',
          };
        }
        
        const quantity = parseFloat(item.quantity) || 0;
        const total = material.price * quantity;
        
        return {
          ...item,
          found: true,
          material: {
            name: material.name,
            price: material.price,
            unit: material.unit,
            brand: material.brand,
          },
          quantity,
          total: Math.round(total * 100) / 100,
        };
      });

      const totalCost = results.reduce((sum: number, r: any) => sum + r.total, 0);

      res.json({
        ok: true,
        items: results,
        summary: {
          totalCost: Math.round(totalCost * 100) / 100,
          itemCount: results.length,
          foundCount: results.filter((r: any) => r.found).length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  /**
   * GET /v1/materials/template
   * 下载价格表模板
   */
  router.get('/template', async (req: Request, res: Response) => {
    try {
      const template = `材料名称,分类,子分类,单价,单位,品牌,规格,地区
实木复合地板,floor,木地板,280,元/㎡,圣象,15mm厚E0级,北京
强化复合地板,floor,木地板,120,元/㎡,大自然,12mm厚,北京
微水泥,floor,艺术地坪,450,元/㎡,西卡,3-5mm厚,上海
乳胶漆,wall,涂料,45,元/㎡,立邦,五合一,北京
艺术涂料,wall,艺术漆,280,元/㎡,威罗,天鹅绒,上海
`;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=材料价格表模板.csv');
      res.send('\uFEFF' + template); // BOM for Excel
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}
