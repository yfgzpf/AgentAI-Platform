import pytesseract
from PIL import Image, ImageEnhance, ImageFilter
import numpy as np
from typing import Dict, Any, List, Optional
import cv2
from io import BytesIO
from loguru import logger


class OCRService:
    def __init__(self, tesseract_path: Optional[str] = None):
        if tesseract_path:
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
        logger.info("OCR服务初始化完成")
    
    def preprocess_image(self, image: Image.Image) -> Image.Image:
        """预处理图像以提高OCR准确率"""
        try:
            logger.info("开始预处理图像")
            
            image = image.convert('RGB')
            
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(2.0)
            
            enhancer = ImageEnhance.Sharpness(image)
            image = enhancer.enhance(2.0)
            
            image = image.filter(ImageFilter.MedianFilter(size=3))
            
            image_array = np.array(image)
            gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
            
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            kernel = np.ones((1, 1), np.uint8)
            binary = cv2.dilate(binary, kernel, iterations=1)
            
            processed_image = Image.fromarray(binary)
            
            logger.info("图像预处理完成")
            return processed_image
            
        except Exception as e:
            logger.error(f"图像预处理失败: {str(e)}")
            raise
    
    def recognize_text(
        self,
        image: Image.Image,
        language: str = 'chi_sim+eng',
        preprocess: bool = True
    ) -> Dict[str, Any]:
        """识别图像中的文本"""
        try:
            logger.info(f"开始识别文本，语言: {language}")
            
            if preprocess:
                image = self.preprocess_image(image)
            
            text = pytesseract.image_to_string(image, lang=language, config='--psm 6')
            
            data = pytesseract.image_to_data(image, lang=language, output_type=pytesseract.Output.DICT)
            
            words = []
            for i in range(len(data['text'])):
                if data['text'][i].strip():
                    words.append({
                        'text': data['text'][i],
                        'confidence': int(data['conf'][i]),
                        'bbox': {
                            'left': data['left'][i],
                            'top': data['top'][i],
                            'width': data['width'][i],
                            'height': data['height'][i]
                        }
                    })
            
            result = {
                'text': text.strip(),
                'words': words,
                'language': language,
                'word_count': len(words),
                'char_count': len(text.strip())
            }
            
            logger.info(f"文本识别完成，识别到 {len(words)} 个词")
            return result
            
        except Exception as e:
            logger.error(f"文本识别失败: {str(e)}")
            raise
    
    def recognize_handwriting(
        self,
        image: Image.Image,
        language: str = 'chi_sim+eng'
    ) -> Dict[str, Any]:
        """识别手写文本"""
        try:
            logger.info("开始识别手写文本")
            
            image = self.preprocess_image(image)
            
            custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ一二三四五六七八九十百千万亿'
            
            text = pytesseract.image_to_string(image, lang=language, config=custom_config)
            
            data = pytesseract.image_to_data(image, lang=language, config=custom_config, output_type=pytesseract.Output.DICT)
            
            words = []
            for i in range(len(data['text'])):
                if data['text'][i].strip():
                    words.append({
                        'text': data['text'][i],
                        'confidence': int(data['conf'][i]),
                        'bbox': {
                            'left': data['left'][i],
                            'top': data['top'][i],
                            'width': data['width'][i],
                            'height': data['height'][i]
                        }
                    })
            
            result = {
                'text': text.strip(),
                'words': words,
                'language': language,
                'word_count': len(words),
                'char_count': len(text.strip()),
                'type': 'handwriting'
            }
            
            logger.info(f"手写文本识别完成，识别到 {len(words)} 个词")
            return result
            
        except Exception as e:
            logger.error(f"手写文本识别失败: {str(e)}")
            raise
    
    def extract_structured_data(
        self,
        image: Image.Image,
        template: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """提取结构化数据"""
        try:
            logger.info("开始提取结构化数据")
            
            result = self.recognize_text(image)
            
            if template:
                structured_data = {}
                for field in template.get('fields', []):
                    field_name = field['name']
                    keywords = field.get('keywords', [])
                    
                    for word in result['words']:
                        if any(keyword in word['text'] for keyword in keywords):
                            structured_data[field_name] = word['text']
                            break
                
                result['structured_data'] = structured_data
            
            return result
            
        except Exception as e:
            logger.error(f"结构化数据提取失败: {str(e)}")
            raise
    
    def recognize_table(
        self,
        image: Image.Image
    ) -> List[List[str]]:
        """识别表格"""
        try:
            logger.info("开始识别表格")
            
            image_array = np.array(image)
            gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
            
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            
            vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 20))
            vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, vertical_kernel, iterations=2)
            
            horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 1))
            horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, horizontal_kernel, iterations=2)
            
            table_mask = cv2.add(vertical_lines, horizontal_lines)
            
            contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            cells = []
            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)
                if w > 30 and h > 20:
                    cells.append((x, y, w, h))
            
            cells.sort(key=lambda x: (x[1], x[0]))
            
            table_data = []
            current_row = []
            last_y = None
            
            for x, y, w, h in cells:
                if last_y is None or abs(y - last_y) < 20:
                    current_row.append((x, y, w, h))
                else:
                    current_row.sort(key=lambda x: x[0])
                    table_data.append(current_row)
                    current_row = [(x, y, w, h)]
                last_y = y
            
            if current_row:
                current_row.sort(key=lambda x: x[0])
                table_data.append(current_row)
            
            result = []
            for row in table_data:
                row_data = []
                for x, y, w, h in row:
                    cell_image = image.crop((x, y, x + w, y + h))
                    cell_text = pytesseract.image_to_string(cell_image, lang='chi_sim+eng', config='--psm 7')
                    row_data.append(cell_text.strip())
                result.append(row_data)
            
            logger.info(f"表格识别完成，识别到 {len(result)} 行 {len(result[0]) if result else 0} 列")
            return result
            
        except Exception as e:
            logger.error(f"表格识别失败: {str(e)}")
            raise
    
    def recognize_document(
        self,
        image: Image.Image,
        language: str = 'chi_sim+eng'
    ) -> Dict[str, Any]:
        """识别文档"""
        try:
            logger.info("开始识别文档")
            
            result = self.recognize_text(image, language)
            
            lines = result['text'].split('\n')
            
            paragraphs = []
            current_paragraph = []
            
            for line in lines:
                if line.strip():
                    current_paragraph.append(line.strip())
                elif current_paragraph:
                    paragraphs.append(' '.join(current_paragraph))
                    current_paragraph = []
            
            if current_paragraph:
                paragraphs.append(' '.join(current_paragraph))
            
            result['lines'] = lines
            result['paragraphs'] = paragraphs
            result['paragraph_count'] = len(paragraphs)
            
            logger.info(f"文档识别完成，识别到 {len(paragraphs)} 个段落")
            return result
            
        except Exception as e:
            logger.error(f"文档识别失败: {str(e)}")
            raise
    
    def enhance_ocr_accuracy(
        self,
        image: Image.Image,
        iterations: int = 3
    ) -> Dict[str, Any]:
        """通过多次迭代提高OCR准确率"""
        try:
            logger.info(f"开始提高OCR准确率，迭代次数: {iterations}")
            
            results = []
            for i in range(iterations):
                result = self.recognize_text(image, preprocess=True)
                results.append(result)
            
            best_result = max(results, key=lambda x: x['word_count'])
            
            logger.info(f"OCR准确率提高完成，最佳结果包含 {best_result['word_count']} 个词")
            return best_result
            
        except Exception as e:
            logger.error(f"提高OCR准确率失败: {str(e)}")
            raise
