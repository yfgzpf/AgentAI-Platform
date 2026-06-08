import React, { useState, useCallback } from 'react'
import {
  Modal,
  Upload,
  Button,
  List,
  Typography,
  Tag,
  Progress,
  Space,
  message,
  Image,
  Tooltip,
  Card
} from 'antd'
import {
  UploadOutlined,
  FileOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileZipOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
  InboxOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import type { UploadFile, UploadProps } from 'antd/es/upload/interface'

const { Text, Paragraph } = Typography
const { Dragger } = Upload

export interface UploadedFile {
  uid: string
  name: string
  size: number
  type: string
  status: 'uploading' | 'done' | 'error'
  percent?: number
  url?: string
  thumbUrl?: string
}

interface FileUploadProps {
  visible: boolean
  onClose: () => void
  onUpload: (files: UploadedFile[]) => void
  maxCount?: number
  maxSize?: number
  accept?: string
}

const getFileIcon = (type: string) => {
  if (type.startsWith('image/')) return <FileImageOutlined className="text-blue-500" />
  if (type === 'application/pdf') return <FilePdfOutlined className="text-red-500" />
  if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return <FileZipOutlined className="text-yellow-500" />
  if (type.includes('text') || type.includes('document') || type.includes('sheet')) return <FileTextOutlined className="text-green-500" />
  return <FileOutlined className="text-gray-500" />
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const FileUpload: React.FC<FileUploadProps> = ({
  visible,
  onClose,
  onUpload,
  maxCount = 10,
  maxSize = 50,
  accept
}) => {
  const [fileList, setFileList] = useState<UploadedFile[]>([])
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null)

  const handleUpload = useCallback((file: File): boolean => {
    if (file.size > maxSize * 1024 * 1024) {
      message.error(`文件大小不能超过 ${maxSize}MB`)
      return false
    }

    const newFile: UploadedFile = {
      uid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'uploading',
      percent: 0,
    }

    setFileList(prev => [...prev, newFile])

    const interval = setInterval(() => {
      setFileList(prev => prev.map(f => {
        if (f.uid === newFile.uid) {
          const newPercent = Math.min((f.percent || 0) + 10, 100)
          return {
            ...f,
            percent: newPercent,
            status: newPercent === 100 ? 'done' : 'uploading'
          }
        }
        return f
      }))
    }, 100)

    setTimeout(() => {
      clearInterval(interval)
      setFileList(prev => prev.map(f => {
        if (f.uid === newFile.uid) {
          return {
            ...f,
            status: 'done',
            percent: 100,
            url: URL.createObjectURL(file),
            thumbUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          }
        }
        return f
      }))
      message.success(`${file.name} 上传成功`)
    }, 1500)

    return false
  }, [maxSize])

  const handleRemove = (uid: string) => {
    setFileList(prev => prev.filter(f => f.uid !== uid))
  }

  const handleConfirm = () => {
    const doneFiles = fileList.filter(f => f.status === 'done')
    onUpload(doneFiles)
    setFileList([])
    onClose()
    message.success(`已上传 ${doneFiles.length} 个文件`)
  }

  const handleCancel = () => {
    setFileList([])
    onClose()
  }

  const uploadProps: UploadProps = {
    multiple: true,
    maxCount,
    accept,
    beforeUpload: handleUpload,
    showUploadList: false,
  }

  return (
    <>
      <Modal
        title={
          <Space>
            <UploadOutlined />
            <span>文件上传</span>
          </Space>
        }
        open={visible}
        onCancel={handleCancel}
        width={600}
        footer={[
          <Button key="cancel" onClick={handleCancel}>
            取消
          </Button>,
          <Button
            key="upload"
            type="primary"
            onClick={handleConfirm}
            disabled={fileList.filter(f => f.status === 'done').length === 0}
          >
            确认上传 ({fileList.filter(f => f.status === 'done').length})
          </Button>,
        ]}
      >
        <Dragger {...uploadProps} className="mb-4">
          <p className="ant-upload-drag-icon">
            <InboxOutlined className="text-4xl text-primary" />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">
            支持单个或批量上传，最多 {maxCount} 个文件，单个文件不超过 {maxSize}MB
          </p>
        </Dragger>

        <AnimatePresence>
          {fileList.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Card size="small" title={`文件列表 (${fileList.length})`}>
                <List
                  dataSource={fileList}
                  renderItem={(file) => (
                    <List.Item
                      actions={[
                        file.status === 'done' && file.type.startsWith('image/') && (
                          <Tooltip title="预览">
                            <Button
                              type="text"
                              icon={<EyeOutlined />}
                              onClick={() => setPreviewFile(file)}
                            />
                          </Tooltip>
                        ),
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemove(file.uid)}
                          />
                        </Tooltip>,
                      ].filter(Boolean)}
                    >
                      <List.Item.Meta
                        avatar={
                          file.thumbUrl ? (
                            <Image
                              src={file.thumbUrl}
                              width={40}
                              height={40}
                              style={{ borderRadius: 4, objectFit: 'cover' }}
                              preview={false}
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center">
                              {getFileIcon(file.type)}
                            </div>
                          )
                        }
                        title={
                          <div className="flex items-center gap-2">
                            <Text className="truncate max-w-[200px]">{file.name}</Text>
                            {file.status === 'done' && (
                              <Tag color="success" className="m-0">完成</Tag>
                            )}
                            {file.status === 'uploading' && (
                              <Tag color="processing" className="m-0">上传中</Tag>
                            )}
                            {file.status === 'error' && (
                              <Tag color="error" className="m-0">失败</Tag>
                            )}
                          </div>
                        }
                        description={
                          <div className="flex items-center gap-2">
                            <Text type="secondary" className="text-xs">
                              {formatSize(file.size)}
                            </Text>
                            {file.status === 'uploading' && (
                              <Progress
                                percent={file.percent}
                                size="small"
                                style={{ width: 100 }}
                                showInfo={false}
                              />
                            )}
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </Modal>

      <Modal
        open={!!previewFile}
        onCancel={() => setPreviewFile(null)}
        footer={null}
        width={800}
        centered
      >
        {previewFile?.thumbUrl && (
          <Image
            src={previewFile.thumbUrl}
            style={{ maxWidth: '100%', maxHeight: '70vh' }}
          />
        )}
      </Modal>
    </>
  )
}

export default FileUpload
