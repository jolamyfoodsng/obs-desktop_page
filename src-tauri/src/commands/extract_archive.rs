use std::fs::{self, File};
use std::path::{Component, Path, PathBuf};

use tar::Archive;
use xz2::read::XzDecoder;
use zip::read::ZipArchive;

use crate::models::plugin::PluginPackageFileType;
use crate::utils::errors::AppError;

fn sanitize_relative_path(path: &Path) -> Result<PathBuf, AppError> {
    let mut sanitized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) | Component::ParentDir => {
                return Err(AppError::message(
                    "Archive entry tried to escape the extraction directory.",
                ));
            }
        }
    }

    if sanitized.as_os_str().is_empty() {
        return Err(AppError::message("Archive entry path was empty."));
    }

    Ok(sanitized)
}

fn extract_zip(
    archive_path: &Path,
    destination: &Path,
    should_cancel: &dyn Fn() -> bool,
) -> Result<(), AppError> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;

    for index in 0..archive.len() {
        if should_cancel() {
            return Err(AppError::canceled(
                "Installation was canceled during extraction.",
            ));
        }

        let mut entry = archive.by_index(index)?;
        let relative_path = entry
            .enclosed_name()
            .ok_or_else(|| AppError::message("Archive entry contained an unsafe path."))?;
        let output_path = destination.join(relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output_file = File::create(output_path)?;
        std::io::copy(&mut entry, &mut output_file)?;

        if should_cancel() {
            return Err(AppError::canceled(
                "Installation was canceled during extraction.",
            ));
        }
    }

    Ok(())
}

fn extract_tar_xz(
    archive_path: &Path,
    destination: &Path,
    should_cancel: &dyn Fn() -> bool,
) -> Result<(), AppError> {
    let file = File::open(archive_path)?;
    let decoder = XzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    for entry in archive.entries()? {
        if should_cancel() {
            return Err(AppError::canceled(
                "Installation was canceled during extraction.",
            ));
        }

        let mut entry = entry?;
        let relative_path = sanitize_relative_path(&entry.path()?)?;
        let output_path = destination.join(relative_path);

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        entry.unpack(output_path)?;

        if should_cancel() {
            return Err(AppError::canceled(
                "Installation was canceled during extraction.",
            ));
        }
    }

    Ok(())
}

pub fn extract_archive(
    archive_path: &Path,
    destination: &Path,
    file_type: &PluginPackageFileType,
    should_cancel: &dyn Fn() -> bool,
) -> Result<(), AppError> {
    if destination.exists() {
        fs::remove_dir_all(destination)?;
    }
    fs::create_dir_all(destination)?;

    match file_type {
        PluginPackageFileType::Zip => extract_zip(archive_path, destination, should_cancel),
        PluginPackageFileType::TarXz => extract_tar_xz(archive_path, destination, should_cancel),
        _ => Err(AppError::message(
            "Only ZIP and tar.xz archives support one-click extraction in this MVP.",
        )),
    }
}
