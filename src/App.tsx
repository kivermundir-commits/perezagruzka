import { useEffect, useRef, useState } from 'react'
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import './App.css'

type Screen = 'home' | 'safety' | 'modes' | 'cameraPrep' | 'camera' | 'result'
type Mode = 'Мягкая растяжка' | 'Ежедневная перезагрузка'
type ArmStage = 'down' | 'up'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [selectedMode, setSelectedMode] = useState<Mode>('Мягкая растяжка')
  const [cameraError, setCameraError] = useState('')
  const [poseStatus, setPoseStatus] = useState('Ожидаем запуск камеры')
  const [repCount, setRepCount] = useState(0)
  const [coachHint, setCoachHint] = useState('Встаньте так, чтобы тело было видно полностью.')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const animationRef = useRef<number | null>(null)

  const repCountRef = useRef(0)
  const armStageRef = useRef<ArmStage>('down')
  const lastRepTimeRef = useRef(0)

  const chooseMode = (mode: Mode) => {
    setSelectedMode(mode)
    setScreen('cameraPrep')
  }

  const resetWorkout = () => {
    repCountRef.current = 0
    armStageRef.current = 'down'
    lastRepTimeRef.current = 0
    setRepCount(0)
    setCoachHint('Встаньте так, чтобы тело было видно полностью.')
    setPoseStatus('Ожидаем запуск камеры')
  }

  const startCamera = async () => {
    setCameraError('')
    resetWorkout()
    setPoseStatus('Запускаем камеру')
    setScreen('camera')
  }

  const finishWorkout = () => {
    stopCamera()
    setScreen('result')
  }

  const getCoachResult = () => {
    if (repCount === 0) {
      return 'Тренировка не была засчитана, потому что приложение не увидело полный цикл движения. Попробуйте встать дальше от камеры, чтобы были видны руки и плечи.'
    }

    if (repCount < 5) {
      return 'Хорошее начало. Вы выполнили несколько повторений. В следующий раз попробуйте двигаться чуть медленнее и следить, чтобы руки поднимались выше уровня плеч.'
    }

    if (repCount < 10) {
      return 'Отличная работа. Движение получилось стабильным. Для полного подхода осталось немного, но качество выполнения уже хорошее.'
    }

    return 'Прекрасно. Вы выполнили полный подход. Движение было достаточно уверенным. В следующий раз можно сохранить такой же спокойный темп и добавить ещё одно мягкое упражнение.'
  }

  const getQualityLabel = () => {
    if (repCount === 0) return 'Нужно повторить'
    if (repCount < 5) return 'Хорошее начало'
    if (repCount < 10) return 'Стабильно'
    return 'Полный подход'
  }

  const stopCamera = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  const drawPose = (
    landmarks: NormalizedLandmark[],
    canvas: HTMLCanvasElement
  ) => {
    const context = canvas.getContext('2d')
    if (!context) return

    const drawingUtils = new DrawingUtils(context)

    drawingUtils.drawConnectors(
      landmarks,
      PoseLandmarker.POSE_CONNECTIONS,
      {
        color: '#ff7aa8',
        lineWidth: 4,
      }
    )

    drawingUtils.drawLandmarks(landmarks, {
      color: '#ffffff',
      lineWidth: 2,
      radius: 4,
    })
  }

  const isPointVisible = (point?: NormalizedLandmark) => {
    return point && (point.visibility ?? 1) > 0.55
  }

  const analyzeArmRaise = (landmarks: NormalizedLandmark[]) => {
    const leftShoulder = landmarks[11]
    const rightShoulder = landmarks[12]
    const leftWrist = landmarks[15]
    const rightWrist = landmarks[16]

    if (
      !isPointVisible(leftShoulder) ||
      !isPointVisible(rightShoulder) ||
      !isPointVisible(leftWrist) ||
      !isPointVisible(rightWrist)
    ) {
      setCoachHint('Покажите руки и плечи полностью в кадре.')
      return
    }

    const averageShoulderY = (leftShoulder.y + rightShoulder.y) / 2
    const averageWristY = (leftWrist.y + rightWrist.y) / 2

    const handsAreUp = averageWristY < averageShoulderY - 0.08
    const handsAreDown = averageWristY > averageShoulderY + 0.12

    if (armStageRef.current === 'down' && handsAreUp) {
      armStageRef.current = 'up'
      setCoachHint('Хорошо. Теперь плавно опустите руки вниз.')
      return
    }

    if (armStageRef.current === 'up' && handsAreDown) {
      const now = Date.now()

      if (now - lastRepTimeRef.current > 700) {
        repCountRef.current += 1
        lastRepTimeRef.current = now
        setRepCount(repCountRef.current)
        setCoachHint('Отлично, повтор засчитан.')
      }

      armStageRef.current = 'down'
      return
    }

    if (armStageRef.current === 'down') {
      setCoachHint('Поднимите руки выше уровня плеч.')
    }

    if (armStageRef.current === 'up') {
      setCoachHint('Опустите руки вниз до исходного положения.')
    }
  }

  useEffect(() => {
    if (screen !== 'camera') {
      stopCamera()
      return
    }

    let isActive = true

    const setupPoseAndCamera = async () => {
      try {
        setPoseStatus('Загружаем модель распознавания тела')

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )

        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })

        poseLandmarkerRef.current = poseLandmarker

        setPoseStatus('Запрашиваем доступ к камере')

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1080 },
            height: { ideal: 1920 },
          },
          audio: false,
        })

        if (!isActive) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setPoseStatus('Встаньте полностью в кадр')

        const predict = () => {
          const video = videoRef.current
          const canvas = canvasRef.current
          const landmarker = poseLandmarkerRef.current

          if (!video || !canvas || !landmarker) {
            animationRef.current = requestAnimationFrame(predict)
            return
          }

          if (video.videoWidth === 0 || video.videoHeight === 0) {
            animationRef.current = requestAnimationFrame(predict)
            return
          }

          canvas.width = video.videoWidth
          canvas.height = video.videoHeight

          const context = canvas.getContext('2d')
          if (context) {
            context.clearRect(0, 0, canvas.width, canvas.height)
          }

          const result = landmarker.detectForVideo(video, performance.now())

          if (result.landmarks && result.landmarks.length > 0) {
            const landmarks = result.landmarks[0]
            drawPose(landmarks, canvas)
            analyzeArmRaise(landmarks)
            setPoseStatus('Тело распознано')
          } else {
            setPoseStatus('Встаньте так, чтобы тело было видно полностью')
            setCoachHint('Камера пока не видит тело полностью.')
          }

          animationRef.current = requestAnimationFrame(predict)
        }

        predict()
      } catch (error) {
        console.error(error)
        setCameraError(
          'Не удалось включить камеру или распознавание тела. Проверьте разрешения браузера и подключение к интернету.'
        )
        setPoseStatus('Ошибка запуска')
      }
    }

    setupPoseAndCamera()

    return () => {
      isActive = false
      stopCamera()
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close()
        poseLandmarkerRef.current = null
      }
    }
  }, [screen])

  return (
    <main className="app">
      {screen === 'home' && (
        <section className="hero-card">
          <div className="badge">MVP • веб-версия</div>

          <h1>Перезагрузка</h1>

          <p className="subtitle">
            ИИ-тренер для мягкого восстановления после родов
          </p>

          <p className="description">
            Приложение анализирует движения через камеру, считает повторы
            и даёт мягкие подсказки по технике выполнения упражнений.
          </p>

          <div className="features">
            <div className="feature">
              <span>01</span>
              <p>Работает через камеру телефона</p>
            </div>

            <div className="feature">
              <span>02</span>
              <p>Считает выполненные повторения</p>
            </div>

            <div className="feature">
              <span>03</span>
              <p>Даёт комментарии как домашний тренер</p>
            </div>
          </div>

          <button
            className="primary-button"
            onClick={() => setScreen('safety')}
          >
            Начать тренировку
          </button>

          <button className="secondary-button">
            Как это работает
          </button>
        </section>
      )}

      {screen === 'safety' && (
        <section className="hero-card">
          <div className="badge">Перед началом</div>

          <h2>Безопасность</h2>

          <p className="subtitle small">
            Восстановление должно быть мягким и спокойным
          </p>

          <p className="description">
            Приложение не заменяет врача. Перед началом занятий после родов
            рекомендуется получить разрешение специалиста.
          </p>

          <div className="warning-box">
            <p>
              Не выполняйте упражнения при боли, сильном дискомфорте,
              головокружении, кровотечении или плохом самочувствии.
            </p>
          </div>

          <div className="features">
            <div className="feature">
              <span>✓</span>
              <p>Занимайтесь только в комфортном темпе</p>
            </div>

            <div className="feature">
              <span>✓</span>
              <p>Остановитесь, если почувствуете боль</p>
            </div>

            <div className="feature">
              <span>✓</span>
              <p>Поставьте телефон устойчиво перед собой</p>
            </div>
          </div>

          <button
            className="primary-button"
            onClick={() => setScreen('modes')}
          >
            Я понимаю, продолжить
          </button>

          <button
            className="secondary-button"
            onClick={() => setScreen('home')}
          >
            Назад
          </button>
        </section>
      )}

      {screen === 'modes' && (
        <section className="hero-card">
          <div className="badge">Выбор режима</div>

          <h2>Тренировка</h2>

          <p className="subtitle small">
            Выберите мягкий режим восстановления
          </p>

          <p className="description">
            Для пробной версии доступны два режима. Остальные направления
            будут добавлены после тестирования MVP.
          </p>

          <div className="mode-list">
            <button
              className="mode-card active"
              onClick={() => chooseMode('Мягкая растяжка')}
            >
              <div>
                <h3>Мягкая растяжка</h3>
                <p>Лёгкие движения для спины, плеч и корпуса.</p>
              </div>
              <span>5 мин</span>
            </button>

            <button
              className="mode-card active"
              onClick={() => chooseMode('Ежедневная перезагрузка')}
            >
              <div>
                <h3>Ежедневная перезагрузка</h3>
                <p>Короткая тренировка для спокойной активности дома.</p>
              </div>
              <span>7 мин</span>
            </button>

            <button className="mode-card locked">
              <div>
                <h3>Осанка</h3>
                <p>Упражнения для мягкого раскрытия грудного отдела.</p>
              </div>
              <span>скоро</span>
            </button>

            <button className="mode-card locked">
              <div>
                <h3>Дыхание</h3>
                <p>Спокойные дыхательные практики и расслабление.</p>
              </div>
              <span>скоро</span>
            </button>
          </div>

          <button
            className="secondary-button"
            onClick={() => setScreen('safety')}
          >
            Назад
          </button>
        </section>
      )}

      {screen === 'cameraPrep' && (
        <section className="hero-card">
          <div className="badge">Подготовка камеры</div>

          <h2>Почти готовы</h2>

          <p className="subtitle small">Режим: {selectedMode}</p>

          <p className="description">
            Сейчас приложение подготовит камеру. Поставьте телефон так,
            чтобы он устойчиво стоял перед вами.
          </p>

          <div className="camera-preview-placeholder">
            <div className="phone-icon">📱</div>
            <p>Камера будет включена на следующем шаге</p>
          </div>

          <div className="features">
            <div className="feature">
              <span>1</span>
              <p>Встаньте на расстоянии 1,5–2 метра от телефона</p>
            </div>

            <div className="feature">
              <span>2</span>
              <p>В кадре должны быть видны голова, руки, корпус и ноги</p>
            </div>

            <div className="feature">
              <span>3</span>
              <p>Лучше заниматься при хорошем освещении</p>
            </div>
          </div>

          <button className="primary-button" onClick={startCamera}>
            Включить камеру
          </button>

          <button
            className="secondary-button"
            onClick={() => setScreen('modes')}
          >
            Назад
          </button>
        </section>
      )}

      {screen === 'camera' && (
        <section className="training-screen">
          <div className="training-header">
            <div>
              <div className="badge">Камера активна</div>
              <h2>{selectedMode}</h2>
            </div>

            <button
              className="small-button"
              onClick={() => setScreen('cameraPrep')}
            >
              Назад
            </button>
          </div>

          <div className="camera-frame">
            {cameraError ? (
              <div className="camera-error">
                <p>{cameraError}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  className="camera-video"
                  playsInline
                  muted
                  autoPlay
                />
                <canvas ref={canvasRef} className="pose-canvas" />
              </>
            )}
          </div>

          <div className="training-panel">
            <p className="exercise-name">Подъём рук вверх</p>
            <p className="counter">Повторы: {repCount} / 10</p>
            <p className="hint">{poseStatus}</p>
            <p className="coach-hint">{coachHint}</p>
          </div>

          <button className="primary-button" onClick={finishWorkout}>
            Завершить и показать итог
          </button>
        </section>
      )}

      {screen === 'result' && (
        <section className="hero-card">
          <div className="badge">Итог тренировки</div>

          <h2>Готово</h2>

          <p className="subtitle small">
            {getQualityLabel()}
          </p>

          <div className="result-card">
            <div className="result-row">
              <span>Режим</span>
              <strong>{selectedMode}</strong>
            </div>

            <div className="result-row">
              <span>Упражнение</span>
              <strong>Подъём рук вверх</strong>
            </div>

            <div className="result-row">
              <span>Повторы</span>
              <strong>{repCount} / 10</strong>
            </div>
          </div>

          <div className="ai-comment">
            <p className="ai-title">Комментарий ИИ-тренера</p>
            <p>{getCoachResult()}</p>
          </div>

          <button className="primary-button" onClick={startCamera}>
            Повторить тренировку
          </button>

          <button
            className="secondary-button"
            onClick={() => setScreen('modes')}
          >
            Выбрать другой режим
          </button>

          <button
            className="secondary-button"
            onClick={() => {
              resetWorkout()
              setScreen('home')
            }}
          >
            На главный экран
          </button>
        </section>
      )}
    </main>
  )
}

export default App