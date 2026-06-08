"""
向量数据库服务
用于存储和检索装修建材知识库的向量表示
"""
import numpy as np
import faiss
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
from sentence_transformers import SentenceTransformer
from loguru import logger
import pickle


class VectorDBService:
    """向量数据库服务类"""
    
    def __init__(self, 
                 embedding_model_name: str = 'paraphrase-multilingual-MiniLM-L12-v2',
                 index_file: str = "data/vector_index.faiss",
                 metadata_file: str = "data/vector_metadata.pkl"):
        """
        初始化向量数据库服务
        
        Args:
            embedding_model_name: 嵌入模型名称
            index_file: 向量索引文件路径
            metadata_file: 元数据文件路径
        """
        self.embedding_model_name = embedding_model_name
        self.index_file = index_file
        self.metadata_file = metadata_file
        
        # 加载嵌入模型
        try:
            self.embedding_model = SentenceTransformer(embedding_model_name, 
                                                     cache_folder="./models/embedding_model")
            logger.info("嵌入模型加载成功")
        except Exception as e:
            logger.warning(f"无法加载嵌入模型 {embedding_model_name}: {e}")
            # 尝试使用本地模型
            try:
                self.embedding_model = SentenceTransformer('./models/embedding_model')
                logger.info("使用本地嵌入模型")
            except Exception as e2:
                logger.warning(f"无法加载本地嵌入模型: {e2}")
                self.embedding_model = None
        
        # 初始化向量索引和元数据
        self.index = None
        self.metadata = []
        
        # 尝试加载已存在的索引
        self.load_index()
    
    def create_embeddings(self, texts: List[str]) -> np.ndarray:
        """
        为文本列表创建嵌入向量
        
        Args:
            texts: 文本列表
            
        Returns:
            嵌入向量矩阵
        """
        if self.embedding_model is None:
            raise RuntimeError("嵌入模型未加载，无法创建嵌入向量")
        
        embeddings = self.embedding_model.encode(texts)
        # 归一化向量以提高余弦相似度计算的准确性
        faiss.normalize_L2(embeddings)
        return embeddings.astype('float32')
    
    def add_texts(self, texts: List[str], metadatas: List[Dict[str, Any]] = None):
        """
        添加文本到向量数据库
        
        Args:
            texts: 文本列表
            metadatas: 对应的元数据列表
        """
        if not texts:
            return
            
        # 创建嵌入向量
        embeddings = self.create_embeddings(texts)
        dim = embeddings.shape[1]
        
        # 如果索引不存在，创建新的索引
        if self.index is None:
            self.index = faiss.IndexFlatIP(dim)  # 内积相似度（归一化后相当于余弦相似度）
        
        # 添加向量到索引
        self.index.add(embeddings)
        
        # 添加元数据
        if metadatas is None:
            metadatas = [{}] * len(texts)
        
        for metadata in metadatas:
            self.metadata.append(metadata)
        
        logger.info(f"已添加 {len(texts)} 个文本到向量数据库")
    
    def similarity_search(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        """
        相似性搜索
        
        Args:
            query: 查询文本
            k: 返回结果数量
            
        Returns:
            搜索结果列表
        """
        if self.index is None or self.index.ntotal == 0:
            return []
        
        # 创建查询向量
        query_embedding = self.create_embeddings([query])
        
        # 搜索最相似的向量
        scores, indices = self.index.search(query_embedding, k)
        
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < len(self.metadata):
                result = {
                    "score": float(score),
                    "metadata": self.metadata[idx],
                    "text": self.metadata[idx].get("content", "")
                }
                results.append(result)
        
        return results
    
    def save_index(self):
        """保存向量索引和元数据到磁盘"""
        index_dir = Path(self.index_file).parent
        index_dir.mkdir(parents=True, exist_ok=True)
        
        # 保存索引
        if self.index is not None:
            faiss.write_index(self.index, self.index_file)
        
        # 保存元数据
        with open(self.metadata_file, 'wb') as f:
            pickle.dump(self.metadata, f)
        
        logger.info(f"向量索引已保存到 {self.index_file} 和 {self.metadata_file}")
    
    def load_index(self):
        """从磁盘加载向量索引和元数据"""
        try:
            # 加载索引
            if Path(self.index_file).exists():
                self.index = faiss.read_index(self.index_file)
                logger.info(f"已从 {self.index_file} 加载向量索引")
            else:
                logger.info(f"向量索引文件不存在: {self.index_file}")
            
            # 加载元数据
            if Path(self.metadata_file).exists():
                with open(self.metadata_file, 'rb') as f:
                    self.metadata = pickle.load(f)
                logger.info(f"已从 {self.metadata_file} 加载元数据，共 {len(self.metadata)} 条记录")
            else:
                logger.info(f"元数据文件不存在: {self.metadata_file}")
                
        except Exception as e:
            logger.error(f"加载向量索引失败: {str(e)}")
            self.index = None
            self.metadata = []
    
    def reset(self):
        """重置向量数据库"""
        self.index = None
        self.metadata = []
        logger.info("向量数据库已重置")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取数据库统计信息"""
        return {
            "total_vectors": self.index.ntotal if self.index else 0,
            "dimension": self.index.d if self.index else 0,
            "metadata_count": len(self.metadata),
            "index_file": str(self.index_file),
            "metadata_file": str(self.metadata_file)
        }


class KnowledgeBaseService:
    """知识库服务类，整合向量数据库和知识管理"""
    
    def __init__(self, vector_db: VectorDBService, knowledge_file: str = "data/knowledge_base.json"):
        """
        初始化知识库服务
        
        Args:
            vector_db: 向量数据库服务实例
            knowledge_file: 知识库文件路径
        """
        self.vector_db = vector_db
        self.knowledge_file = knowledge_file
        
        # 加载知识库
        self.load_knowledge_base()
    
    def load_knowledge_base(self):
        """从文件加载知识库到向量数据库"""
        try:
            kb_path = Path(self.knowledge_file)
            if kb_path.exists():
                with open(kb_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                knowledge_entries = data.get('knowledge_base', [])
                
                if knowledge_entries and self.vector_db.index is None:
                    # 如果向量数据库为空，批量添加知识库内容
                    texts = []
                    metadatas = []
                    
                    for entry in knowledge_entries:
                        texts.append(entry.get('content', ''))
                        metadatas.append({
                            'id': entry.get('id'),
                            'category': entry.get('category'),
                            'subcategory': entry.get('subcategory', ''),
                            'title': entry.get('title'),
                            'content': entry.get('content'),
                            'tags': entry.get('tags', []),
                            'source': entry.get('source', 'knowledge_base')
                        })
                    
                    self.vector_db.add_texts(texts, metadatas)
                    self.vector_db.save_index()
                    
                    logger.info(f"已从 {self.knowledge_file} 加载 {len(knowledge_entries)} 条知识库记录")
                elif knowledge_entries:
                    logger.info(f"知识库文件存在，但向量数据库已有内容，跳过加载")
            else:
                logger.warning(f"知识库文件不存在: {self.knowledge_file}")
                
        except Exception as e:
            logger.error(f"加载知识库失败: {str(e)}")
    
    def add_knowledge(self, content: str, category: str = "", subcategory: str = "", 
                     title: str = "", tags: List[str] = None, source: str = ""):
        """
        添加知识到知识库
        
        Args:
            content: 知识内容
            category: 类别
            subcategory: 子类别
            title: 标题
            tags: 标签列表
            source: 来源
        """
        if tags is None:
            tags = []
        
        # 生成唯一ID
        import uuid
        entry_id = f"kb_{uuid.uuid4().hex[:8]}"
        
        # 添加到向量数据库
        metadata = {
            'id': entry_id,
            'category': category,
            'subcategory': subcategory,
            'title': title,
            'content': content,
            'tags': tags,
            'source': source
        }
        
        self.vector_db.add_texts([content], [metadata])
        self.vector_db.save_index()
        
        # 更新知识库文件
        self._update_knowledge_file(entry_id, category, subcategory, title, content, tags, source)
        
        logger.info(f"已添加新知识到知识库，ID: {entry_id}")
    
    def _update_knowledge_file(self, entry_id: str, category: str, subcategory: str, 
                              title: str, content: str, tags: List[str], source: str):
        """更新知识库文件"""
        kb_path = Path(self.knowledge_file)
        kb_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 读取现有数据
        if kb_path.exists():
            with open(kb_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = {"knowledge_base": [], "metadata": {}}
        
        # 添加新条目
        new_entry = {
            "id": entry_id,
            "category": category,
            "subcategory": subcategory,
            "title": title,
            "content": content,
            "tags": tags,
            "source": source
        }
        
        data["knowledge_base"].append(new_entry)
        
        # 更新元数据
        data["metadata"]["last_updated"] = str(__import__('datetime').datetime.now())
        data["metadata"]["total_entries"] = len(data["knowledge_base"])
        
        # 写回文件
        with open(kb_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    def search_knowledge(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """
        搜索知识库
        
        Args:
            query: 查询文本
            k: 返回结果数量
            
        Returns:
            搜索结果列表
        """
        results = self.vector_db.similarity_search(query, k)
        
        # 格式化结果
        formatted_results = []
        for result in results:
            formatted_result = {
                "id": result["metadata"].get("id"),
                "title": result["metadata"].get("title"),
                "category": result["metadata"].get("category"),
                "subcategory": result["metadata"].get("subcategory"),
                "content": result["metadata"].get("content"),
                "tags": result["metadata"].get("tags"),
                "source": result["metadata"].get("source"),
                "similarity_score": result["score"]
            }
            formatted_results.append(formatted_result)
        
        return formatted_results
    
    def get_categories(self) -> List[str]:
        """获取所有知识类别"""
        categories = set()
        for item in self.vector_db.metadata:
            category = item.get('category')
            if category:
                categories.add(category)
        return list(categories)
    
    def get_stats(self) -> Dict[str, Any]:
        """获取知识库统计信息"""
        vector_stats = self.vector_db.get_stats()
        return {
            **vector_stats,
            "categories": self.get_categories(),
            "knowledge_file": str(self.knowledge_file)
        }


# 示例用法
if __name__ == "__main__":
    # 创建向量数据库服务
    vector_db = VectorDBService()
    
    # 创建知识库服务
    kb_service = KnowledgeBaseService(vector_db)
    
    # 示例：添加新知识
    # kb_service.add_knowledge(
    #     content="瓷砖选购时需要检查平整度、色差、硬度和吸水率等指标。",
    #     category="材料选购",
    #     subcategory="瓷砖",
    #     title="瓷砖选购要点",
    #     tags=["瓷砖", "选购", "质量", "检验"],
    #     source="建材专家建议"
    # )
    
    # 示例：搜索知识
    # results = kb_service.search_knowledge("如何选购瓷砖", k=2)
    # for result in results:
    #     print(f"标题: {result['title']}")
    #     print(f"内容: {result['content'][:100]}...")
    #     print(f"相似度: {result['similarity_score']:.3f}")
    #     print("---")
    
    print("向量数据库服务初始化完成")
    print(f"统计信息: {kb_service.get_stats()}")