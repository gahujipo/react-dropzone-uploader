import React from 'react'
import PropTypes from 'prop-types'

import FilePreviewDefault from './FilePreview'
import SubmitButtonDefault from './SubmitButton'
import DropzoneContentDefault from './DropzoneContent'
import { formatBytes, formatDuration } from './string'
import './FileUploader.css'

let id = 0

class FileUploader extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      active: false,
    }
    this._files = [] // fileWithMeta objects: { file, meta }
  }

  componentWillUnmount() {
    for (const file of this._files) {
      if (file.meta.status === 'uploading') file.xhr.abort()
    }
  }

  handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    this.setState({ active: true })
  }

  handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    clearTimeout(this._timeoutId)
    this.setState({ active: true })
  }

  handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    // prevents repeated toggling of `active` state when file is dragged over children of uploader
    // see: https://www.smashingmagazine.com/2018/01/drag-drop-file-uploader-vanilla-js/
    this._timeoutId = setTimeout(() => this.setState({ active: false }), 150)
  }

  handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    this.setState({ active: false })

    const { dataTransfer: { files } } = e
    this.handleFiles([...files])
  }

  handleSubmit = () => {
    const { onSubmit, submitAll } = this.props
    if (!onSubmit) return

    if (submitAll) onSubmit(this._files)
    else onSubmit(this._files.filter(f => f.meta.status === 'done'))
  }

  handleCancel = (_id) => {
    const index = this._files.findIndex(f => f.meta.id === _id)
    if (index !== -1 && this._files[index].xhr) {
      if (this.props.onCancel) this.props.onCancel(this._files[index])
      this._files[index].xhr.abort()
    }
  }

  handleRemove = (_id) => {
    const index = this._files.findIndex(f => f.meta.id === _id)
    if (index !== -1) {
      if (this.props.onRemove) this.props.onRemove(this._files[index])
      this._files.splice(index, 1)
      this.forceUpdate()
    }
  }

  // expects an array of File objects
  handleFiles = (files) => {
    files.forEach(this.handleFile)
  }

  handleChangeStatus = (fileWithMeta) => {
    if (!this.props.onChangeStatus) return
    this.props.onChangeStatus(fileWithMeta, fileWithMeta.meta.status)
  }

  handleFile = async (file) => {
    const { name, size, type, lastModified } = file
    const {
      maxSizeBytes,
      maxFiles,
      allowedTypePrefixes,
      getUploadParams,
      onUploadReady,
    } = this.props

    if (allowedTypePrefixes && !allowedTypePrefixes.some(p => type.startsWith(p))) return
    if (this._files.length >= maxFiles) return

    const uploadedDate = new Date().toISOString()
    const lastModifiedDate = lastModified && new Date(lastModified).toISOString()
    const fileWithMeta = {
      file,
      meta: { name, size, type, lastModifiedDate, uploadedDate, status: 'preparing', percent: 0, id },
    }
    this._files.push(fileWithMeta)
    this.handleChangeStatus(fileWithMeta)
    this.forceUpdate()
    id += 1

    if (size > maxSizeBytes) {
      fileWithMeta.meta.status = 'error_file_size'
      this.handleChangeStatus(fileWithMeta)
      this.forceUpdate()
      return
    }

    await this.generatePreview(fileWithMeta)

    let triggered = false
    const triggerUpload = () => {
      // becomes NOOP after first invocation
      if (triggered) return
      triggered = true

      if (getUploadParams) {
        this.uploadFile(fileWithMeta)
        fileWithMeta.meta.status = 'uploading'
      } else {
        fileWithMeta.meta.status = 'done'
      }
      this.handleChangeStatus(fileWithMeta)
      this.forceUpdate()
    }

    if (onUploadReady) {
      fileWithMeta.triggerUpload = triggerUpload
      const r = onUploadReady(fileWithMeta)
      if (r && r.delayUpload === true) return
    }

    triggerUpload()
  }

  generatePreview = async (fileWithMeta) => {
    const { previewTypes } = this.props

    const { meta: { type }, file } = fileWithMeta
    const isImage = type.startsWith('image/')
    const isAudio = type.startsWith('audio/')
    const isVideo = type.startsWith('video/')
    if (!isImage && !isAudio && !isVideo) return

    const objectUrl = URL.createObjectURL(file)

    const fileCallbackToPromise = (fileObj, callback) => {
      return new Promise((resolve) => { fileObj[callback] = resolve })
    }

    try {
      if (isImage && previewTypes.includes('image')) {
        const img = new Image()
        img.src = objectUrl
        fileWithMeta.meta.previewUrl = objectUrl
        await fileCallbackToPromise(img, 'onload')
        fileWithMeta.meta.width = img.width
        fileWithMeta.meta.height = img.height
      }

      if (isAudio && previewTypes.includes('audio')) {
        const audio = new Audio()
        audio.src = objectUrl
        await fileCallbackToPromise(audio, 'onloadedmetadata')
        fileWithMeta.meta.duration = audio.duration
      }

      if (isVideo && previewTypes.includes('video')) {
        const video = document.createElement('video')
        video.src = objectUrl
        await fileCallbackToPromise(video, 'onloadedmetadata')
        fileWithMeta.meta.duration = video.duration
        fileWithMeta.meta.videoWidth = video.videoWidth
        fileWithMeta.meta.videoHeight = video.videoHeight
      }
      URL.revokeObjectURL(objectUrl)
    } catch (e) { URL.revokeObjectURL(objectUrl) }
    this.forceUpdate()
  }

  uploadFile = async (fileWithMeta) => {
    const { getUploadParams } = this.props
    const params = await getUploadParams(fileWithMeta)
    const { fields = {}, headers = {}, meta: extraMeta = {}, method = 'POST', url } = params || {}

    if (!url) {
      fileWithMeta.meta.status = 'error_upload_params'
      this.handleChangeStatus(fileWithMeta)
      this.forceUpdate()
      return
    }

    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    xhr.open(method, url, true)

    for (const field of Object.keys(fields)) formData.append(field, fields[field])
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
    for (const header of Object.keys(headers)) xhr.setRequestHeader(header, headers[header])
    fileWithMeta.meta = { ...fileWithMeta.meta, ...extraMeta }

    // update progress (can be used to show progress indicator)
    xhr.upload.addEventListener('progress', (e) => {
      fileWithMeta.meta.percent = ((e.loaded * 100.0) / e.total) || 100
      this.forceUpdate()
    })

    xhr.addEventListener('readystatechange', () => {
      // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/readyState
      if (xhr.readyState !== 2 && xhr.readyState !== 4) return

      if (xhr.status === 0) {
        fileWithMeta.meta.status = 'aborted'
        this.handleChangeStatus(fileWithMeta)
        this.forceUpdate()
      } else if (xhr.status < 400) {
        fileWithMeta.meta.percent = 100
        if (xhr.readyState === 2) fileWithMeta.meta.status = 'headers_received'
        if (xhr.readyState === 4) fileWithMeta.meta.status = 'done'
        this.handleChangeStatus(fileWithMeta)
        this.forceUpdate()
      } else {
        fileWithMeta.meta.status = 'error_upload'
        this.handleChangeStatus(fileWithMeta)
        this.forceUpdate()
      }
    })

    formData.append('file', fileWithMeta.file)
    xhr.send(formData)
    fileWithMeta.xhr = xhr
  }

  render() {
    const {
      maxFiles,
      accept,
      onSubmit,
      getUploadParams,
      canCancel,
      canRemove,
      FilePreviewComponent,
      SubmitButtonComponent,
      DropzoneContentComponent,
      dropzoneClassName,
      dropzoneActiveClassName,
      submitButtonClassName,
      dropzoneContentClassName,
    } = this.props
    const { active } = this.state

    const FilePreview = FilePreviewComponent || FilePreviewDefault
    const SubmitButton = SubmitButtonComponent || SubmitButtonDefault
    const DropzoneContent = DropzoneContentComponent || DropzoneContentDefault

    let containerClassName = dropzoneClassName || 'uploader-dropzone'
    if (active) containerClassName = `${containerClassName} ${dropzoneActiveClassName || 'uploader-active'}`

    const files = this._files.map((f) => {
      return (
        <FilePreview
          key={f.meta.id}
          meta={{ ...f.meta }}
          isUpload={Boolean(getUploadParams)}
          onCancel={canCancel ? () => this.handleCancel(f.meta.id) : undefined}
          onRemove={canRemove ? () => this.handleRemove(f.meta.id) : undefined}
        />
      )
    })

    return (
      <React.Fragment>
        <div
          className={containerClassName}
          onDragEnter={this.handleDragEnter}
          onDragOver={this.handleDragOver}
          onDragLeave={this.handleDragLeave}
          onDrop={this.handleDrop}
        >
          <DropzoneContent
            className={dropzoneContentClassName}
            accept={accept}
            maxFiles={maxFiles}
            handleFiles={this.handleFiles}
            files={files}
          />
        </div>

        {this._files.length > 0 && onSubmit &&
          <SubmitButton
            className={submitButtonClassName}
            onSubmit={this.handleSubmit}
            disabled={
              this._files.some(f => f.meta.status === 'uploading' || f.meta.status === 'preparing') ||
              !this._files.some(f => ['headers_received', 'done'].includes(f.meta.status))
            }
          />
        }
      </React.Fragment>
    )
  }
}

FileUploader.propTypes = {
  onChangeStatus: PropTypes.func,
  onUploadReady: PropTypes.func,
  getUploadParams: PropTypes.func, // should return { fields = {}, headers = {}, meta = {}, url = '' }

  onSubmit: PropTypes.func,
  onCancel: PropTypes.func,
  onRemove: PropTypes.func,

  submitAll: PropTypes.bool,
  canCancel: PropTypes.bool,
  canRemove: PropTypes.bool,
  previewTypes: PropTypes.arrayOf(PropTypes.oneOf(['image', 'audio', 'video'])),

  allowedTypePrefixes: PropTypes.arrayOf(PropTypes.string),
  accept: PropTypes.string, // the accept attribute of the input
  maxSizeBytes: PropTypes.number.isRequired,
  maxFiles: PropTypes.number.isRequired,

  FilePreviewComponent: PropTypes.any,
  SubmitButtonComponent: PropTypes.any,
  DropzoneContentComponent: PropTypes.any,

  dropzoneClassName: PropTypes.string,
  dropzoneActiveClassName: PropTypes.string,
  dropzoneContentClassName: PropTypes.string,
  submitButtonClassName: PropTypes.string,
}

FileUploader.defaultProps = {
  submitAll: false,
  canCancel: true,
  canRemove: true,
  previewTypes: ['image', 'audio', 'video'],
  accept: '*',
  maxSizeBytes: Number.MAX_SAFE_INTEGER,
  maxFiles: Number.MAX_SAFE_INTEGER,
}

export default FileUploader
export { formatBytes, formatDuration }
